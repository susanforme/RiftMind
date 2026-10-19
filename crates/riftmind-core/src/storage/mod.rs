use crate::contracts::*;
use sqlx::{Row,SqlitePool,sqlite::{SqliteConnectOptions,SqlitePoolOptions,SqliteJournalMode}};
use std::{path::{Path,PathBuf},str::FromStr,time::Duration};
use sha2::{Digest,Sha256};
pub const MIGRATION:&str=include_str!("../../../../src-tauri/migrations/0001_stage1.sql");
pub const TABLES:&[&str]=&["players","matches","match_participants","source_snapshots","match_revisions","jobs","sync_state","resource_manifests"];
pub fn now()->String{chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true)}
pub fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
pub async fn connect(path:&Path)->Result<SqlitePool>{
 let opt=SqliteConnectOptions::from_str("sqlite:")?.filename(path).create_if_missing(true).foreign_keys(true).journal_mode(SqliteJournalMode::Wal).busy_timeout(Duration::from_secs(3));
 Ok(SqlitePoolOptions::new().max_connections(4).after_connect(|conn,_|Box::pin(async move{sqlx::query("PRAGMA foreign_keys=ON").execute(&mut *conn).await?;sqlx::query("PRAGMA busy_timeout=3000").execute(conn).await?;Ok(())})).connect_with(opt).await?)
}
pub async fn preflight(path:&Path)->Result<()> {
 if !path.exists(){return Ok(())}
 let pool=SqlitePoolOptions::new().max_connections(1).connect_with(SqliteConnectOptions::new().filename(path).read_only(true)).await?;
 let version:i64=sqlx::query_scalar("PRAGMA user_version").fetch_one(&pool).await?;
 let integrity:String=sqlx::query_scalar("PRAGMA quick_check").fetch_one(&pool).await?;
 if version>1||integrity!="ok"{pool.close().await;return Err(AppError::new(ErrorCode::BackupInvalid))}
 if version<1{let backup=path.with_extension(format!("pre-migration-{}.db",uuid::Uuid::new_v4()));vacuum_backup(&pool,&backup).await?;}
 pool.close().await;Ok(())
}
pub async fn open(path:&Path)->Result<SqlitePool>{preflight(path).await?;let pool=connect(path).await?;let mut tx=pool.begin().await?;sqlx::raw_sql(MIGRATION).execute(&mut *tx).await?;tx.commit().await?;Ok(pool)}
pub async fn vacuum_backup(pool:&SqlitePool,path:&Path)->Result<()>{
 let p=path.to_string_lossy().replace('\'',"''");sqlx::query(&format!("VACUUM INTO '{p}'")).execute(pool).await?;Ok(())
}
pub async fn save_player(pool:&SqlitePool,p:&Player)->Result<()> {sqlx::query("INSERT INTO players VALUES(?,?,?,?,?) ON CONFLICT(player_key) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at").bind(&p.player_key).bind(&p.server_id).bind(&p.puuid).bind(&p.display_name).bind(&p.updated_at).execute(pool).await?;Ok(())}
pub async fn players(pool:&SqlitePool)->Result<Vec<Player>>{let rows=sqlx::query("SELECT * FROM players ORDER BY updated_at DESC,player_key").fetch_all(pool).await?;Ok(rows.iter().map(|r|Player{player_key:r.get("player_key"),server_id:r.get("server_id"),puuid:r.get("puuid"),display_name:r.get("display_name"),updated_at:r.get("updated_at")}).collect())}
pub async fn list(pool:&SqlitePool,q:MatchQuery)->Result<MatchPage>{
 crate::domain::validate_key(&q.player_key)?;let limit=q.page_size.unwrap_or(50);if !(1..=100).contains(&limit){return Err(AppError::new(ErrorCode::InvalidInput))}
 for d in [&q.from,&q.to].into_iter().flatten(){if chrono::DateTime::parse_from_rfc3339(d).is_err(){return Err(AppError::new(ErrorCode::InvalidInput))}}
 if let (Some(a),Some(b))=(&q.from,&q.to){if a>b{return Err(AppError::new(ErrorCode::InvalidInput))}}
 let cursor=if let Some(s)=q.cursor {let c:Vec<String>=serde_json::from_str(&s)?;if c.len()!=4||c[0]!=q.player_key||c[1]!=hash(serde_json::to_string(&(&q.queue_id,&q.champion_id,&q.from,&q.to))?.as_bytes()){return Err(AppError::new(ErrorCode::InvalidInput))}Some(c)}else{None};
 let mut b=sqlx::QueryBuilder::new("SELECT p.projection,m.started_at,m.match_key FROM match_participants p JOIN matches m USING(match_key) WHERE p.player_key=");b.push_bind(&q.player_key);
 macro_rules! filter {($v:expr,$sql:expr)=>{if let Some(v)=$v {b.push($sql).push_bind(v);}};}
 filter!(q.queue_id," AND m.queue_id=");filter!(q.champion_id," AND p.champion_id=");filter!(&q.from," AND m.started_at>=");filter!(&q.to," AND m.started_at<=");
 let mut count=sqlx::QueryBuilder::new("SELECT COUNT(*) FROM (");count.push(b.sql()).push(")");
 // Count shares the same validated filters; cursor never changes the total.
 let total:i64=sqlx::query_scalar("SELECT COUNT(*) FROM match_participants p JOIN matches m USING(match_key) WHERE p.player_key=? AND (? IS NULL OR m.queue_id=?) AND (? IS NULL OR p.champion_id=?) AND (? IS NULL OR m.started_at>=?) AND (? IS NULL OR m.started_at<=?)").bind(&q.player_key).bind(q.queue_id).bind(q.queue_id).bind(q.champion_id).bind(q.champion_id).bind(&q.from).bind(&q.from).bind(&q.to).bind(&q.to).fetch_one(pool).await?;
 if let Some(c)=&cursor{b.push(" AND (m.started_at < ").push_bind(&c[2]).push(" OR (m.started_at = ").push_bind(&c[2]).push(" AND m.match_key < ").push_bind(&c[3]).push("))");}
 b.push(" ORDER BY m.started_at DESC,m.match_key DESC LIMIT ").push_bind(limit+1);
 let rows=b.build().fetch_all(pool).await?;let more=rows.len()>limit as usize;let items:Vec<MatchSummary>=rows.iter().take(limit as usize).map(|r|serde_json::from_str(r.get("projection"))).collect::<std::result::Result<_,_>>()?;
 let next_cursor=if more {let last=items.last().unwrap();Some(serde_json::to_string(&[q.player_key.clone(),hash(serde_json::to_string(&(&q.queue_id,&q.champion_id,&q.from,&q.to))?.as_bytes()),last.started_at.clone(),last.match_key.clone()])?)}else{None};
 let coverage=sqlx::query("SELECT * FROM sync_state WHERE player_key=?").bind(q.player_key).fetch_optional(pool).await?.map(|r|Coverage{last_sync:r.get("last_sync"),pages:r.get::<i64,_>("pages") as u32,matches_count:r.get::<i64,_>("matches_count") as u32,exhausted:r.get("exhausted")});
 Ok(MatchPage{items,next_cursor,total:total as u32,coverage})
}
pub async fn commit_page(pool:&SqlitePool,task:&Task,items:&[MatchSummary],raw:&serde_json::Value,exhausted:bool)->Result<()> {
 let mut tx=pool.begin().await?;let payload=serde_json::to_string(raw)?;let h=hash(payload.as_bytes());
 sqlx::query("INSERT OR IGNORE INTO source_snapshots VALUES(?,?,?,?)").bind(&h).bind("summary").bind(payload).bind(now()).execute(&mut *tx).await?;
 for item in items{
  let old=sqlx::query("SELECT projection,revision,source FROM match_participants WHERE match_key=? AND player_key=?").bind(&item.match_key).bind(&item.player_key).fetch_optional(&mut *tx).await?;
  let mut item=item.clone();let mut changed=true;
  if let Some(r)=old{let mut prev:MatchSummary=serde_json::from_str(r.get("projection"))?;item.revision=prev.revision;changed=serde_json::to_value(&prev)?!=serde_json::to_value(&item)?;if prev.source==Source::Sgp&&item.source==Source::Lcu{changed=false;}if changed{prev.revision+=1;item.revision=prev.revision;}}
  if !changed{continue}
  sqlx::query("INSERT OR IGNORE INTO matches VALUES(?,?,?,?,?,?)").bind(&item.match_key).bind(&item.server_id).bind(&item.game_id).bind(&item.started_at).bind(item.queue_id).bind(&item.version).execute(&mut *tx).await?;
  sqlx::query("INSERT INTO match_participants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(match_key,player_key) DO UPDATE SET champion_id=excluded.champion_id,outcome=excluded.outcome,kills=excluded.kills,deaths=excluded.deaths,assists=excluded.assists,duration=excluded.duration,position=excluded.position,cs=excluded.cs,items=excluded.items,source=excluded.source,fallback_reason=excluded.fallback_reason,revision=excluded.revision,projection=excluded.projection").bind(&item.match_key).bind(&item.player_key).bind(item.champion_id).bind(format!("{:?}",item.outcome)).bind(item.kills).bind(item.deaths).bind(item.assists).bind(item.duration).bind(&item.position).bind(item.cs).bind(serde_json::to_string(&item.items)?).bind(if item.source==Source::Sgp{"sgp"}else{"lcu"}).bind(&item.fallback_reason).bind(item.revision).bind(serde_json::to_string(&item)?).execute(&mut *tx).await?;
  sqlx::query("INSERT INTO match_revisions VALUES(?,?,?,?)").bind(&item.match_key).bind(&item.player_key).bind(item.revision).bind(&h).execute(&mut *tx).await?;
 }
 sqlx::query("UPDATE jobs SET checkpoint=?,updated_at=? WHERE id=?").bind(task.checkpoint).bind(now()).bind(&task.id).execute(&mut *tx).await?;
 sqlx::query("INSERT INTO sync_state VALUES(?,?,?,(SELECT COUNT(*) FROM match_participants WHERE player_key=?),?) ON CONFLICT(player_key) DO UPDATE SET last_sync=excluded.last_sync,pages=excluded.pages,matches_count=excluded.matches_count,exhausted=excluded.exhausted").bind(task.player_key.as_ref()).bind(now()).bind(task.checkpoint).bind(task.player_key.as_ref()).bind(exhausted).execute(&mut *tx).await?;
 tx.commit().await?;Ok(())
}
pub async fn task(pool:&SqlitePool,id:&str)->Result<Task>{crate::domain::validate_key(id)?;let r=sqlx::query("SELECT * FROM jobs WHERE id=?").bind(id).fetch_optional(pool).await?.ok_or(AppError::new(ErrorCode::NotFound))?;Ok(Task{id:r.get("id"),player_key:r.get("player_key"),state:serde_json::from_value(serde_json::Value::String(r.get("state")))?,checkpoint:r.get::<i64,_>("checkpoint") as u32,budget:r.get::<i64,_>("budget") as u32,session_epoch:r.get("session_epoch"),updated_at:r.get("updated_at"),error:r.get::<Option<String>,_>("error").map(|s|serde_json::from_str(&s)).transpose()?})}
pub async fn bytes(path:PathBuf)->u64{let mut size=0;let mut stack=vec![path];while let Some(p)=stack.pop(){if let Ok(m)=tokio::fs::symlink_metadata(&p).await {if m.is_file(){size+=m.len()}else if m.is_dir(){if let Ok(mut dir)=tokio::fs::read_dir(p).await{while let Ok(Some(e))=dir.next_entry().await{stack.push(e.path())}}}}}size}
