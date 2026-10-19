use crate::{contracts::*,domain,storage};
use async_trait::async_trait;
use serde_json::{Value,json};
use std::{sync::Arc,time::Duration};
use tokio::sync::Mutex;

#[async_trait]
pub trait MatchRemote:Send+Sync {async fn page(&self,player:&Player,offset:u32,source:Source)->Result<Value>;}
#[derive(Clone)]
pub struct LcuClient{client:reqwest::Client,base:String,token:String}
impl LcuClient {
 pub fn new(port:u16,token:String)->Result<Self>{if port==0||token.is_empty(){return Err(AppError::new(ErrorCode::InvalidInput))}Ok(Self{client:reqwest::Client::builder().no_proxy().danger_accept_invalid_certs(true).redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(10)).build().map_err(|_|AppError::new(ErrorCode::NetworkUnavailable))?,base:format!("https://127.0.0.1:{port}"),token})}
 pub async fn get(&self,path:&str)->Result<Value>{
  if !["/lol-summoner/v1/current-summoner","/riotclient/region-locale","/lol-rso-auth/v1/authorization","/entitlements/v1/token","/lol-league-session/v1/league-session-token","/lol-gameflow/v1/gameflow-phase"].contains(&path)&&!path.starts_with("/lol-match-history/v1/products/lol/"){return Err(AppError::new(ErrorCode::Forbidden))}
  let res=self.client.get(format!("{}{path}",self.base)).basic_auth("riot",Some(&self.token)).send().await.map_err(|_|AppError::new(ErrorCode::NetworkUnavailable))?;bounded_json(res).await
 }
 pub fn ws_credentials(&self)->(&str,&str){(&self.base,&self.token)}
 pub async fn tokens(&self)->Result<Tokens>{let rso=self.get("/entitlements/v1/token").await?;let league=self.get("/lol-league-session/v1/league-session-token").await?;Ok(Tokens {rso:rso.get("accessToken").and_then(Value::as_str).map(str::to_string),league:league.as_str().map(str::to_string)})}
}
#[derive(Default)]
pub struct Tokens {pub rso:Option<String>,pub league:Option<String>}
pub struct HttpRemote {pub lcu:Option<LcuClient>,pub server:domain::Server,pub sgp_base:Option<String>,pub tokens:Mutex<Tokens>,client:reqwest::Client,pub refresh_lock:Mutex<u32>}
impl HttpRemote{
 pub fn new(lcu:Option<LcuClient>,server:domain::Server,tokens:Tokens)->Self{Self {lcu,server,sgp_base:None,tokens:Mutex::new(tokens),client:reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(15)).build().unwrap(),refresh_lock:Mutex::new(0)}}
 // Test bridges inject loopback mock origins; the production command registry exposes no override.
 pub fn for_test(base:String,server:domain::Server)->Self{let mut r=Self::new(None,server,Tokens{rso:Some("synthetic-rso".into()),league:Some("synthetic-league".into())});r.sgp_base=Some(base);r}
 async fn sgp(&self,p:&Player,offset:u32)->Result<Value>{
  let mut generation=*self.refresh_lock.lock().await;
  for attempt in 0..3{
   let token={let t=self.tokens.lock().await; t.rso.clone()}.ok_or(AppError::new(ErrorCode::WaitingAuth))?;
   let base=self.sgp_base.as_ref().unwrap_or(&self.server.match_history);
   let url=format!("{base}/match-history-query/v1/products/lol/player/{}/SUMMARY",p.puuid);
   let res=self.client.get(url).query(&[("startIndex",offset.to_string()),("count","50".into())]).bearer_auth(token).send().await;
   match res {
    Ok(res) if res.status().as_u16()==401&&attempt==0=>{
     let mut current=self.refresh_lock.lock().await;if *current==generation{let lcu=self.lcu.as_ref().ok_or(AppError::new(ErrorCode::WaitingAuth))?;*self.tokens.lock().await=lcu.tokens().await?;*current+=1;}generation=*current;
    },
    Ok(res) if res.status().is_server_error()&&attempt<2=>tokio::time::sleep(Duration::from_millis(100*(1<<attempt))).await,
    Ok(res)=>return bounded_json(res).await,
    Err(_) if attempt<2=>tokio::time::sleep(Duration::from_millis(100*(1<<attempt))).await,
    Err(_)=>return Err(AppError::new(ErrorCode::NetworkUnavailable))
   }
  }Err(AppError::new(ErrorCode::NetworkUnavailable))
 }
}
#[async_trait]
impl MatchRemote for HttpRemote{async fn page(&self,p:&Player,offset:u32,source:Source)->Result<Value>{
 domain::validate_key(&p.puuid)?;
 match source{Source::Sgp=>self.sgp(p,offset).await,Source::Lcu=>self.lcu.as_ref().ok_or(AppError::new(ErrorCode::EndpointUnsupported))?.get(&format!("/lol-match-history/v1/products/lol/{}/matches?begIndex={offset}&endIndex={}",p.puuid,offset+49)).await}
}}
pub async fn bounded_json(res:reqwest::Response)->Result<Value>{
 let code=match res.status().as_u16(){200..=299=>None,401=>Some(ErrorCode::WaitingAuth),403=>Some(ErrorCode::Forbidden),404|405=>Some(ErrorCode::EndpointUnsupported),429=>Some(ErrorCode::RateLimited),_=>Some(ErrorCode::NetworkUnavailable)};
 if let Some(code)=code{let mut e=AppError::new(code);if e.code==ErrorCode::RateLimited{e.params.insert("retryAfter".into(),res.headers().get("retry-after").and_then(|v|v.to_str().ok()).unwrap_or("60").into());}return Err(e)}
 if res.content_length().is_some_and(|l|l>8*1024*1024){return Err(AppError::new(ErrorCode::InvalidInput))}
 let mut bytes=Vec::new();let mut res=res;while let Some(chunk)=res.chunk().await.map_err(|_|AppError::new(ErrorCode::NetworkUnavailable))?{if bytes.len()+chunk.len()>8*1024*1024{return Err(AppError::new(ErrorCode::InvalidInput))}bytes.extend(chunk)}Ok(serde_json::from_slice(&bytes)?)
}
fn u(v:&Value,key:&str)->Option<u32>{v.get(key)?.as_u64().and_then(|n|n.try_into().ok())}
fn identifier(v:&Value)->Option<String>{if let Some(s)=v.as_str(){Some(s.into())}else{v.as_u64().map(|n|n.to_string())}}
pub fn normalize(raw:&Value,p:&Player,source:Source,fallback:Option<String>)->Result<Vec<MatchSummary>>{
 let list=raw.get("games").and_then(|v|v.as_array().or_else(||v.get("games").and_then(Value::as_array))).or_else(||raw.as_array()).ok_or(AppError::new(ErrorCode::InvalidInput))?;
 if list.len()>100{return Err(AppError::new(ErrorCode::InvalidInput))}
 list.iter().map(|g|{
  let g=g.get("json").unwrap_or(g);let info=g.get("info").unwrap_or(g);
  let game_id=identifier(info.get("gameId").or_else(||g.get("gameId")).ok_or(AppError::new(ErrorCode::InvalidInput))?).ok_or(AppError::new(ErrorCode::InvalidInput))?;domain::validate_key(&game_id)?;
  let participants=info.get("participants").and_then(Value::as_array).ok_or(AppError::new(ErrorCode::InvalidInput))?;
  let part=participants.iter().find(|v|v.get("puuid").and_then(Value::as_str)==Some(&p.puuid)).or_else(||if participants.len()==1{participants.first()}else{None}).ok_or(AppError::new(ErrorCode::InvalidInput))?;
  let stats=part.get("stats").unwrap_or(part);let timestamp=info.get("gameCreation").or_else(||info.get("gameStartTimestamp")).and_then(Value::as_i64);
  let started=timestamp.and_then(chrono::DateTime::from_timestamp_millis).map(|d|d.to_rfc3339_opts(chrono::SecondsFormat::Millis,true)).or_else(||info.get("gameCreationDate").and_then(Value::as_str).and_then(|s|chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d|d.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis,true))).ok_or(AppError::new(ErrorCode::InvalidInput))?;
  let outcome=if stats.get("gameEndedInEarlySurrender").and_then(Value::as_bool)==Some(true){Outcome::Remake}else{match stats.get("win").and_then(Value::as_bool){Some(true)=>Outcome::Win,Some(false)=>Outcome::Loss,None=>Outcome::Unknown}};
  let items=(0..7).filter_map(|n|u(stats,&format!("item{n}"))).filter(|n|*n>0).collect();
  Ok(MatchSummary{match_key:format!("{}:{game_id}",p.server_id),player_key:p.player_key.clone(),game_id,server_id:p.server_id.clone(),started_at:started,queue_id:u(info,"queueId"),champion_id:u(part,"championId"),version:info.get("gameVersion").and_then(Value::as_str).unwrap_or("unknown").into(),outcome,kills:u(stats,"kills"),deaths:u(stats,"deaths"),assists:u(stats,"assists"),duration:u(info,"gameDuration"),position:part.get("teamPosition").and_then(Value::as_str).map(str::to_string),cs:u(stats,"totalMinionsKilled").or_else(||u(stats,"totalMinionsKilled").zip(u(stats,"neutralMinionsKilled")).map(|(a,b)|a+b)),items,source:source.clone(),fallback_reason:fallback.clone(),revision:1})
 }).collect()
}
pub type Remote=Arc<dyn MatchRemote>;
pub fn synthetic_page(p:&Player,offset:u32)->Value{let games:Vec<_>=(offset..(offset+50).min(125)).map(|i|json!({"json":{"gameId":format!("900719925474{}",100+i),"gameCreation":1792108800000_i64-i as i64*3600000,"gameVersion":"16.20.1","queueId":if i%3==0{450}else{420},"gameDuration":1500+i*3,"participants":[{"puuid":p.puuid,"championId":if i%2==0{103}else{64},"kills":8+i%6,"deaths":3+i%4,"assists":12,"totalMinionsKilled":180,"teamPosition":"MIDDLE","win":i%3!=0,"item0":3089,"item1":3020}]}})).collect();json!({"games":games})}
pub fn synthetic_player(server:&str)->Player{Player{player_key:format!("{server}:synthetic-player"),server_id:server.into(),puuid:"synthetic-player".into(),display_name:"Rift Walker #DEMO".into(),updated_at:storage::now()}}
