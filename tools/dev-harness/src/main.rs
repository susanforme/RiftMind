use axum::{Router,Json,extract::{State,Query,WebSocketUpgrade,DefaultBodyLimit},response::IntoResponse,http::{HeaderMap,StatusCode},routing::{post,get}};
use riftmind_core::{contracts::*,storage,services::Service,settings::JsonSettingsStore,clients::{self,HttpRemote},domain};
use serde_json::{Value,json};
use std::{sync::Arc,path::PathBuf,collections::HashMap};
use tokio::sync::Mutex;
#[derive(Clone)]
struct Bridge {service:Arc<Service>,token:String,origin:String,mock_base:String,scenario:Arc<Mutex<Scenario>>}
#[derive(Default)]
struct Scenario{status:u16,delay:u64,calls:u32}
fn allowed(headers:&HeaderMap,b:&Bridge)->bool{headers.get("origin").and_then(|h|h.to_str().ok()).is_none_or(|o|o==b.origin)&&headers.get("x-riftmind-token").and_then(|h|h.to_str().ok())==Some(&b.token)}
async fn command(State(b):State<Bridge>,headers:HeaderMap,Json(cmd):Json<Command>)->impl IntoResponse{if !allowed(&headers,&b){return (StatusCode::FORBIDDEN,Json(json!({"error":"forbidden"})))}
 let result=b.service.dispatch(cmd).await;match result{Ok(v)=>(StatusCode::OK,Json(json!({"ok":v}))),Err(e)=>(StatusCode::OK,Json(json!({"error":e})))}}
async fn events(State(b):State<Bridge>,headers:HeaderMap,Query(q):Query<HashMap<String,String>>,ws:WebSocketUpgrade)->axum::response::Response{
 if headers.get("origin").and_then(|h|h.to_str().ok())!=Some(&b.origin)||q.get("token")!=Some(&b.token){return StatusCode::FORBIDDEN.into_response()}
 let mut rx=b.service.events.subscribe();ws.on_upgrade(move|mut socket|async move{while let Ok(ev)=rx.recv().await{if socket.send(axum::extract::ws::Message::Text(serde_json::to_string(&ev).unwrap().into())).await.is_err(){break}}})
}
async fn mock_page(State(b):State<Bridge>,headers:HeaderMap,Query(q):Query<HashMap<String,String>>)->impl IntoResponse{
 if headers.get("authorization").and_then(|h|h.to_str().ok())!=Some("Bearer synthetic-rso"){return (StatusCode::UNAUTHORIZED,Json(json!({})))}
 let (status,delay)={let mut s=b.scenario.lock().await;s.calls+=1;(s.status,s.delay)};if delay>0{tokio::time::sleep(std::time::Duration::from_millis(delay)).await;}
 if status>=400{return (StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),Json(json!({})))}
 let p=b.service.connection.read().await.player.clone().unwrap_or(clients::synthetic_player("TENCENT_HN1"));let offset=q.get("startIndex").and_then(|v|v.parse().ok()).unwrap_or(0);(StatusCode::OK,Json(clients::synthetic_page(&p,offset)))
}
async fn scenario(State(b):State<Bridge>,headers:HeaderMap,Json(v):Json<Value>)->impl IntoResponse{
 if !allowed(&headers,&b){return (StatusCode::FORBIDDEN,Json(json!({})))}
 let mode=v.get("scenario").and_then(Value::as_str).unwrap_or("tencent");
 {let mut s=b.scenario.lock().await;s.status=v.get("status").and_then(Value::as_u64).unwrap_or(200) as u16;s.delay=v.get("delay").and_then(Value::as_u64).unwrap_or(0).min(5000);s.calls=0;}
 let result=configure(&b,mode).await;(StatusCode::OK,Json(json!({"ok":result.is_ok()})))
}
async fn configure(b:&Bridge,mode:&str)->riftmind_core::contracts::Result<()> {
 if mode=="offline"||mode=="no-client"{return b.service.set_connection(ConnectionState::default(),None).await}
 let (region,platform)=if mode=="riot"{("NA",None)}else if mode=="unknown"{("INVALID",None)}else if mode=="conflict"{("TENCENT",Some("HN1"))}else{("TENCENT",Some("HN1"))};
 let ident=domain::identify(Some(region),platform,if mode=="conflict"{Some("HN10")}else{None});let server=ident.server_id.as_deref().unwrap_or("UNKNOWN");let player=clients::synthetic_player(server);
 let instance=ClientInstance{id:format!("synthetic-{server}"),pid:"1000".into(),started_at:"2026-10-19T00:00:00Z".into(),identification:ident.clone()};*b.service.instances.write().await=vec![instance.clone()];
 let mut c=ConnectionState{phase:if mode=="conflict"{ConnectionPhase::Conflict}else if server=="UNKNOWN"{ConnectionPhase::Unsupported}else{ConnectionPhase::Connected},instance:Some(instance),identification:Some(ident),player:if server!="UNKNOWN"{Some(player)}else{None},sgp_ready:true,lcu_ready:false,..ConnectionState::default()};
 if mode=="waiting"{c.sgp_ready=false;c.phase=ConnectionPhase::WaitingAuth;}
 let remote=domain::servers().into_iter().find(|s|s.id==server).map(|s|Arc::new(HttpRemote::for_test(b.mock_base.clone(),s)) as clients::Remote);
 b.service.set_connection(c,remote).await
}
#[tokio::main]
async fn main(){
 if let Err(e)=run().await{eprintln!("harness failed: {}",e);std::process::exit(1)}
}
async fn run()->Result<(),Box<dyn std::error::Error>> {
 let root=std::env::var("RIFTMIND_TEST_DIR").map(PathBuf::from).unwrap_or_else(|_|std::env::temp_dir().join(format!("riftmind-{}",uuid::Uuid::new_v4())));tokio::fs::create_dir_all(&root).await?;
 let pool=storage::open(&root.join("riftmind.db")).await.map_err(|e|format!("{:?}",e.code))?;let service=Service::new(pool,root.clone(),Arc::new(JsonSettingsStore(root.join("settings.json")))).await.map_err(|e|format!("{:?}",e.code))?;
 let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await?;let mock=tokio::net::TcpListener::bind("127.0.0.1:0").await?;
 let b=Bridge{service:service.clone(),token:uuid::Uuid::new_v4().to_string(),origin:std::env::var("RIFTMIND_ORIGIN").unwrap_or("http://localhost:1420".into()),mock_base:format!("http://{}",mock.local_addr()?),scenario:Arc::new(Mutex::new(Scenario::default()))};
 let mock_app=Router::new().route("/match-history-query/v1/products/lol/player/{puuid}/SUMMARY",get(mock_page)).with_state(b.clone());tokio::spawn(async move{axum::serve(mock,mock_app).await.unwrap()});
 configure(&b,&std::env::var("RIFTMIND_SCENARIO").unwrap_or("no-client".into())).await.map_err(|e|format!("{:?}",e.code))?;
 println!("{}",json!({"port":listener.local_addr()?.port(),"token":b.token,"directory":root}));
 let app=Router::new().route("/command",post(command)).route("/events",get(events)).route("/scenario",post(scenario)).route("/health",get(||async{"ok"})).layer(DefaultBodyLimit::max(65536)).with_state(b);
 axum::serve(listener,app).with_graceful_shutdown(async move{let _=tokio::signal::ctrl_c().await;let _=service.shutdown().await;}).await?;Ok(())
}
