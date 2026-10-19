use crate::{contracts::*,storage,settings::{self,SettingsStore},clients::{self,Remote},domain};
use std::{sync::Arc,path::PathBuf};
use tokio::sync::{RwLock,Mutex,broadcast};
use sqlx::{SqlitePool,Row};
use serde_json::{Value,json};
use base64::{Engine,engine::general_purpose::STANDARD};
pub struct Service {
 pub pool:SqlitePool,pub root:PathBuf,pub state:RwLock<AppState>,pub connection:RwLock<ConnectionState>,pub instances:RwLock<Vec<ClientInstance>>,
 pub settings:Mutex<Settings>,store:Arc<dyn SettingsStore>,pub remote:RwLock<Option<Remote>>,pub events:broadcast::Sender<EventEnvelope>,sequence:std::sync::atomic::AtomicU32,
 maintenance: RwLock<()>,sync_lock:Mutex<()>,
}
impl Service{
 pub async fn new(pool:SqlitePool,root:PathBuf,store:Arc<dyn SettingsStore>)->Result<Arc<Self>>{
  let mut settings=store.load().await?;if settings.theme_id!="default"{settings.theme_id="default".into();}
  store.save(&settings).await?;tokio::fs::create_dir_all(root.join("assets")).await?;tokio::fs::create_dir_all(root.join("backups")).await?;
  sqlx::query("UPDATE jobs SET state='interrupted' WHERE state IN ('running','queued')").execute(&pool).await?;
  let (events,_)=broadcast::channel(256);
  Ok(Arc::new(Self {pool,root,state:RwLock::new(AppState{phase:AppPhase::Ready,runtime_id:uuid::Uuid::new_v4().to_string(),workspace_epoch:uuid::Uuid::new_v4().to_string(),app_version:env!("CARGO_PKG_VERSION").into(),database_version:1,settings_version:1}),connection:RwLock::new(ConnectionState::default()),instances:RwLock::new(vec![]),settings:Mutex::new(settings),store,remote:RwLock::new(None),events,sequence:std::sync::atomic::AtomicU32::new(0),maintenance:RwLock::new(()),sync_lock:Mutex::new(())}))
 }
 pub async fn emit(&self,kind:&str,key:Option<String>,revision:u32){let state=self.state.read().await;let _=self.events.send(EventEnvelope{event_version:1,runtime_id:state.runtime_id.clone(),workspace_epoch:state.workspace_epoch.clone(),sequence:self.sequence.fetch_add(1,std::sync::atomic::Ordering::SeqCst)+1,revision,kind:kind.into(),object_key:key});}
 pub async fn set_connection(self:&Arc<Self>,mut c:ConnectionState,remote:Option<Remote>)->Result<()> {
  let old=self.connection.read().await.clone();let identity_changed=old.player.as_ref().map(|p|&p.player_key)!=c.player.as_ref().map(|p|&p.player_key)||old.instance.as_ref().map(|p|&p.id)!=c.instance.as_ref().map(|p|&p.id);
  c.session_epoch=if identity_changed{uuid::Uuid::new_v4().to_string()}else{old.session_epoch};
  if let Some(p)=&c.player{storage::save_player(&self.pool,p).await?;}
  *self.remote.write().await=remote;*self.connection.write().await=c.clone();self.emit("connection-changed",None,0).await;
  let settings=self.settings.lock().await.clone();
  if c.phase==ConnectionPhase::Connected&&settings.auto_sync&&identity_changed{if let Some(p)=c.player {let _=self.start_sync(SyncRequest{player_key:p.player_key,pages:1}).await;}}
  Ok(())
 }
 pub async fn update_settings(&self,req:UpdateSettings)->Result<Settings>{let _guard=self.maintenance.read().await;self.ready().await?;let mut current=self.settings.lock().await;let next=settings::apply(&current,req)?;self.store.save(&next).await?;*current=next.clone();drop(current);self.emit("settings-changed",None,next.revision).await;Ok(next)}
 async fn ready(&self)->Result<()>{if self.state.read().await.phase!=AppPhase::Ready{Err(AppError::new(ErrorCode::AppNotReady))}else{Ok(())}}
 pub async fn start_sync(self:&Arc<Self>,req:SyncRequest)->Result<Task>{
  let _guard=self.maintenance.read().await;self.ready().await?;domain::validate_key(&req.player_key)?;if !(1..=20).contains(&req.pages){return Err(AppError::new(ErrorCode::InvalidInput))}
  let c=self.connection.read().await.clone();let p=c.player.as_ref().filter(|p|p.player_key==req.player_key).ok_or(AppError::new(ErrorCode::Forbidden))?;
  let ident=c.identification.as_ref().ok_or(AppError::new(ErrorCode::RegionUnknown))?;domain::choose_source(ident,c.sgp_ready,!c.sgp_ready&&c.lcu_ready,&p.server_id)?;
  if c.phase==ConnectionPhase::CoolingDown{return Err(AppError::new(ErrorCode::RateLimited))}
  let _single=self.sync_lock.lock().await;
  if let Some(id)=sqlx::query_scalar::<_,String>("SELECT id FROM jobs WHERE player_key=? AND state IN ('queued','running')").bind(&req.player_key).fetch_optional(&self.pool).await?{return storage::task(&self.pool,&id).await}
  let id=uuid::Uuid::new_v4().to_string();sqlx::query("INSERT INTO jobs(id,player_key,state,checkpoint,budget,session_epoch,updated_at) VALUES(?,?,'queued',0,?,?,?)").bind(&id).bind(&req.player_key).bind(req.pages).bind(&c.session_epoch).bind(storage::now()).execute(&self.pool).await?;
  let t=storage::task(&self.pool,&id).await?;let service=self.clone();let task=t.clone();tokio::spawn(async move{service.run_sync(task).await;});Ok(t)
 }
 async fn run_sync(self:Arc<Self>,mut task:Task){
  let _single=self.sync_lock.lock().await;let result:Result<()>=async {
   sqlx::query("UPDATE jobs SET state='running' WHERE id=?").bind(&task.id).execute(&self.pool).await?;
   let conn=self.connection.read().await.clone();let player=conn.player.as_ref().ok_or(AppError::new(ErrorCode::ClientNotFound))?;
   let remote=self.remote.read().await.clone().ok_or(AppError::new(ErrorCode::ClientNotFound))?;
   let ident=conn.identification.as_ref().ok_or(AppError::new(ErrorCode::RegionUnknown))?;let mut source=domain::choose_source(ident,conn.sgp_ready,!conn.sgp_ready&&conn.lcu_ready,&player.server_id)?;let mut fallback=None;
   while task.checkpoint<task.budget{
    self.checkpoint(&task).await?;
    // Overlap the previous five summaries so insertions at the remote head do not skip a boundary.
    let offset=if task.checkpoint==0{0}else{task.checkpoint*45};
    let raw=match remote.page(player,offset,source.clone()).await {Ok(raw)=>raw,Err(e) if matches!(e.code,ErrorCode::EndpointUnsupported|ErrorCode::NetworkUnavailable)&&source==Source::Sgp&&conn.lcu_ready=>{source=domain::choose_source(ident,false,true,&player.server_id)?;fallback=Some(format!("{:?}",e.code));remote.page(player,offset,source.clone()).await?},Err(e)=>return Err(e)};
    let items=clients::normalize(&raw,player,source.clone(),fallback.clone())?;let exhausted=items.len()<50;task.checkpoint+=1;
    // Hold the identity read lock through commit; a switch waits until this safe checkpoint completes.
    let _workspace=self.maintenance.read().await;let current=self.connection.read().await;if current.session_epoch!=task.session_epoch{return Err(AppError::new(ErrorCode::SessionChanged))}
    self.checkpoint_cancel(&task).await?;storage::commit_page(&self.pool,&task,&items,&raw,exhausted).await?;drop(current);
    self.emit("match-updated",task.player_key.clone(),task.checkpoint).await;self.emit("task-progress",Some(task.id.clone()),task.checkpoint).await;
    if exhausted{break}
   }Ok(())
  }.await;
  let (state,error)=match result{Ok(())=>("completed",None),Err(e)=>{if e.code==ErrorCode::RateLimited{let mut c=self.connection.write().await;c.phase=ConnectionPhase::CoolingDown;c.retry_at=Some((chrono::Utc::now()+chrono::Duration::seconds(60)).to_rfc3339());} (if matches!(e.code,ErrorCode::Cancelled|ErrorCode::SessionChanged){"cancelled"}else{"failed"},Some(serde_json::to_string(&e).unwrap()))}};
  let _=sqlx::query("UPDATE jobs SET state=?,error=?,updated_at=? WHERE id=?").bind(state).bind(error).bind(storage::now()).bind(&task.id).execute(&self.pool).await;
  self.emit("task-progress",Some(task.id),task.checkpoint+1).await;
 }
 async fn checkpoint_cancel(&self,t:&Task)->Result<()> {let cancel:bool=sqlx::query_scalar("SELECT cancel_requested FROM jobs WHERE id=?").bind(&t.id).fetch_one(&self.pool).await?;if cancel{return Err(AppError::new(ErrorCode::Cancelled))}Ok(())}
 async fn checkpoint(&self,t:&Task)->Result<()> {self.ready().await?;if self.connection.read().await.session_epoch!=t.session_epoch{return Err(AppError::new(ErrorCode::SessionChanged))}self.checkpoint_cancel(t).await}
 pub async fn usage(&self)->StorageUsage{StorageUsage{database_bytes:storage::bytes(self.root.join("riftmind.db")).await as f64,asset_bytes:storage::bytes(self.root.join("assets")).await as f64,backup_bytes:storage::bytes(self.root.join("backups")).await as f64}}
 pub async fn backup(&self)->Result<MaintenanceResult>{let _guard=self.maintenance.write().await;self.ready().await?;let id=uuid::Uuid::new_v4().to_string();let db=self.root.join("backups").join(format!("{id}.db"));storage::vacuum_backup(&self.pool,&db).await?;let bytes=tokio::fs::read(&db).await?;let settings=self.settings.lock().await.clone();let data=json!({"schemaVersion":1,"database":STANDARD.encode(&bytes),"sha256":storage::hash(&bytes),"settings":settings});let file=self.root.join("backups").join(format!("{id}.riftmind"));tokio::fs::write(&file,serde_json::to_vec(&data)?).await?;tokio::fs::remove_file(db).await?;Ok(MaintenanceResult{reference:id,workspace_epoch:self.state.read().await.workspace_epoch.clone()})}
 pub async fn restore(&self,id:&str)->Result<MaintenanceResult>{
  domain::validate_key(id)?;if uuid::Uuid::parse_str(id).is_err(){return Err(AppError::new(ErrorCode::InvalidInput))}
  let file=self.root.join("backups").join(format!("{id}.riftmind"));if tokio::fs::metadata(&file).await?.len()>128*1024*1024{return Err(AppError::new(ErrorCode::BackupInvalid))}
  let data:Value=serde_json::from_slice(&tokio::fs::read(file).await?)?;let bytes=STANDARD.decode(data["database"].as_str().ok_or(AppError::new(ErrorCode::BackupInvalid))?).map_err(|_|AppError::new(ErrorCode::BackupInvalid))?;
  if data["schemaVersion"]!=1||data["sha256"]!=storage::hash(&bytes){return Err(AppError::new(ErrorCode::BackupInvalid))}
  let settings:Settings=serde_json::from_value(data["settings"].clone())?;settings::validate(&settings)?;
  let restore_path=self.root.join("backups/restore-candidate.db");tokio::fs::write(&restore_path,&bytes).await?;storage::preflight(&restore_path).await?;
  let _=self.backup().await?;
  let _guard=self.maintenance.write().await;self.state.write().await.phase=AppPhase::Migrating;
  let outcome:Result<()>=async {
   let mut conn=self.pool.acquire().await?;
   sqlx::query("ATTACH DATABASE ? AS restore_source").bind(restore_path.to_string_lossy().as_ref()).execute(&mut *conn).await?;
   let mut tx=sqlx::Connection::begin(&mut *conn).await?;sqlx::query("PRAGMA defer_foreign_keys=ON").execute(&mut *tx).await?;
   for table in storage::TABLES.iter().rev(){sqlx::query(&format!("DELETE FROM {table}")).execute(&mut *tx).await?;}
   for table in storage::TABLES{sqlx::query(&format!("INSERT INTO {table} SELECT * FROM restore_source.{table}")).execute(&mut *tx).await?;}
   sqlx::query("UPDATE jobs SET state='interrupted',cancel_requested=1 WHERE state IN ('running','queued')").execute(&mut *tx).await?;
   let old=self.settings.lock().await.clone();self.store.save(&settings).await?;
   if let Err(e)=tx.commit().await {self.store.save(&old).await?;return Err(e.into())}
   *self.settings.lock().await=settings;sqlx::query("DETACH DATABASE restore_source").execute(&mut *conn).await?;Ok(())
  }.await;
  self.state.write().await.phase=AppPhase::Ready;outcome?;
  self.state.write().await.workspace_epoch=uuid::Uuid::new_v4().to_string();self.emit("workspace-reset",None,0).await;Ok(MaintenanceResult{reference:id.into(),workspace_epoch:self.state.read().await.workspace_epoch.clone()})
 }
 pub async fn diagnostics(&self)->Result<MaintenanceResult>{let id=uuid::Uuid::new_v4().to_string();let c=self.connection.read().await;let data=json!({"app":*self.state.read().await,"connection":{"phase":c.phase,"identification":c.identification,"sgpReady":c.sgp_ready,"lcuReady":c.lcu_ready},"settingsSchema":1,"exportedAt":storage::now()});tokio::fs::write(self.root.join("backups").join(format!("{id}.diagnostics.json")),serde_json::to_vec_pretty(&data)?).await?;Ok(MaintenanceResult{reference:id,workspace_epoch:self.state.read().await.workspace_epoch.clone()})}
 pub async fn shutdown(&self)->Result<()> {self.state.write().await.phase=AppPhase::ShuttingDown;sqlx::query("UPDATE jobs SET cancel_requested=1 WHERE state IN ('queued','running')").execute(&self.pool).await?;let _single=self.sync_lock.lock().await;self.store.save(&self.settings.lock().await.clone()).await?;self.pool.close().await;Ok(())}
 pub async fn dispatch(self:&Arc<Self>,command:Command)->Result<Value>{
  macro_rules! out{($e:expr)=>{Ok(serde_json::to_value($e)?)};}
  match command{
   Command::get_app_state(_)=>out!(self.state.read().await.clone()),Command::get_settings(_)=>out!(self.settings.lock().await.clone()),Command::update_settings(r)=>out!(self.update_settings(r).await?),
   Command::get_connection_state(_)=>out!(self.connection.read().await.clone()),Command::list_client_instances(_)=>out!(self.instances.read().await.clone()),
   Command::retry_connection(_)=>{self.connection.write().await.phase=ConnectionPhase::Discovering;self.emit("connection-retry",None,0).await;out!(self.connection.read().await.clone())},
   Command::select_client_instance(r)=>{domain::validate_key(&r.id)?;let i=self.instances.read().await.iter().find(|i|i.id==r.id).cloned().ok_or(AppError::new(ErrorCode::ClientNotFound))?;self.connection.write().await.instance=Some(i);self.emit("connection-retry",None,0).await;out!(self.connection.read().await.clone())},
   Command::list_players(_)=>out!(storage::players(&self.pool).await?),Command::list_matches(r)=>out!(storage::list(&self.pool,r).await?),Command::sync_player_matches(r)=>out!(self.start_sync(r).await?),
   Command::get_task_status(r)=>out!(storage::task(&self.pool,&r.id).await?),Command::cancel_task(r)=>{domain::validate_key(&r.id)?;sqlx::query("UPDATE jobs SET cancel_requested=1 WHERE id=? AND state IN ('queued','running')").bind(&r.id).execute(&self.pool).await?;out!(storage::task(&self.pool,&r.id).await?)},
   Command::get_storage_usage(_)=>out!(self.usage().await),Command::clear_asset_cache(_)=>{let _guard=self.maintenance.write().await;tokio::fs::remove_dir_all(self.root.join("assets")).await?;tokio::fs::create_dir_all(self.root.join("assets")).await?;sqlx::query("UPDATE resource_manifests SET availability='missing',path=NULL").execute(&self.pool).await?;self.emit("assets-ready",None,0).await;out!(self.usage().await)},
   Command::create_backup(_)=>out!(self.backup().await?),Command::restore_backup(r)=>out!(self.restore(&r.id).await?),Command::export_diagnostics(_)=>out!(self.diagnostics().await?),
   Command::resolve_assets(r)=>out!(self.resolve_assets(r).await?),
   Command::check_for_updates(_)|Command::install_update(_)=>out!(UpdateStatus{state:"unavailable".into(),version:None,downloaded:0.,total:None,reason:Some(ErrorCode::UpdateNotConfigured)})
  }
 }
}
impl Service {
 pub async fn resolve_assets(&self,req:AssetRequest)->Result<Vec<Asset>>{
  if !["zh-CN","en-US"].contains(&req.locale.as_str())||req.champion_ids.len()>100{return Err(AppError::new(ErrorCode::InvalidInput))}
  let parts:Vec<_>=req.version.split('.').collect();if parts.len()<2||parts.len()>4||parts.iter().any(|s|s.is_empty()||s.len()>5||!s.bytes().all(|b|b.is_ascii_digit())){return Err(AppError::new(ErrorCode::InvalidInput))}
  let version=format!("{}.{}",parts[0],parts[1]);let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build().unwrap();let mut assets=vec![];
  for id in req.champion_ids{
   let resource_id=format!("champion:{id}");let key=format!("{version}:{}:{resource_id}",req.locale);
   let existing=sqlx::query("SELECT * FROM resource_manifests WHERE resource_key=?").bind(&key).fetch_optional(&self.pool).await?;
   if let Some(row)=existing {let path:Option<String>=row.get("path");if let Some(path)=path{let local=self.root.join("assets").join(&path);if let Ok(bytes)=tokio::fs::read(&local).await{if Some(storage::hash(&bytes))==row.get::<Option<String>,_>("hash"){assets.push(Asset{resource_id,requested_version:req.version.clone(),actual_version:Some(version.clone()),locale:req.locale.clone(),name:row.get("name"),reference:Some(format!("data:image/png;base64,{}",STANDARD.encode(bytes))),hash:row.get("hash"),availability:"cached".into()});continue}}}}
   let locale=if req.locale=="zh-CN"{"zh_cn"}else{"default"};let base=format!("https://raw.communitydragon.org/{version}/plugins/rcp-be-lol-game-data/global");
   let name=match client.get(format!("{base}/{locale}/v1/champions/{id}.json")).send().await{Ok(r)=>clients::bounded_json(r).await.ok().and_then(|v|v.get("name").and_then(Value::as_str).map(str::to_string)),Err(_)=>None};
   let bytes=match client.get(format!("{base}/default/v1/champion-icons/{id}.png")).send().await{Ok(mut r) if r.status().is_success()&&r.content_length().unwrap_or(0)<=2*1024*1024=>{let mut bytes=vec![];while let Ok(Some(c))=r.chunk().await {bytes.extend(c);if bytes.len()>2*1024*1024{bytes.clear();break}}if bytes.starts_with(b"\x89PNG\r\n\x1a\n"){Some(bytes)}else{None}},_=>None};
   let (path,hash,reference,availability)=if let Some(bytes)=bytes{let h=storage::hash(&bytes);let path=format!("{h}.png");tokio::fs::write(self.root.join("assets").join(&path),&bytes).await?;(Some(path),Some(h),Some(format!("data:image/png;base64,{}",STANDARD.encode(bytes))),"cached")}else{(None,None,None,"missing")};
   sqlx::query("INSERT INTO resource_manifests VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(resource_key) DO UPDATE SET path=excluded.path,hash=excluded.hash,name=excluded.name,availability=excluded.availability").bind(key).bind(&version).bind(&req.locale).bind(&resource_id).bind(path).bind(&hash).bind(&name).bind(availability).execute(&self.pool).await?;
   assets.push(Asset{resource_id,requested_version:req.version.clone(),actual_version:if availability=="cached"{Some(version.clone())}else{None},locale:req.locale.clone(),name,reference,hash,availability:availability.into()});
  }Ok(assets)
 }
}
