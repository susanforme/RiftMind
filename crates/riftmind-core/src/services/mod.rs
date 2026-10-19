pub mod recovery;
pub mod resources;
pub mod review;
pub mod training;
use crate::{
    clients::{self, Remote},
    contracts::*,
    domain,
    settings::{self, SettingsStore},
    storage,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::{path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, RwLock, broadcast};
pub struct Service {
    pub pool: SqlitePool,
    pub resources: RwLock<resources::ResourceClient>,
    pub root: PathBuf,
    pub asset_root: PathBuf,
    pub state: RwLock<AppState>,
    pub connection: RwLock<ConnectionState>,
    pub instances: RwLock<Vec<ClientInstance>>,
    pub settings: Mutex<Settings>,
    store: Arc<dyn SettingsStore>,
    pub remote: RwLock<Option<Remote>>,
    pub events: broadcast::Sender<EventEnvelope>,
    sequence: std::sync::atomic::AtomicU32,
    maintenance: RwLock<()>,
    operations: RwLock<()>,
    changed: tokio::sync::Notify,
    sync_lock: Mutex<()>,
    submit_lock: Mutex<()>,
    review_lock: Mutex<()>,
    detail_lock: tokio::sync::Semaphore,
}
impl Service {
    pub async fn new(
        pool: SqlitePool,
        root: PathBuf,
        store: Arc<dyn SettingsStore>,
    ) -> Result<Arc<Self>> {
        let assets = root.join("assets");
        Self::new_with_assets(pool, root, assets, store).await
    }
    pub async fn new_with_assets(
        pool: SqlitePool,
        root: PathBuf,
        asset_root: PathBuf,
        store: Arc<dyn SettingsStore>,
    ) -> Result<Arc<Self>> {
        resources::prepare_directory(&asset_root).await?;
        storage::review::bootstrap_cached_inputs(&pool).await?;
        let mut settings = store.load().await?;
        if settings.theme_id != "default" {
            settings.theme_id = "default".into();
        }
        store.save(&settings).await?;
        tokio::fs::create_dir_all(root.join("backups")).await?;
        sqlx::query("UPDATE jobs SET state='interrupted' WHERE state IN ('running','queued')")
            .execute(&pool)
            .await?;
        let (events, _) = broadcast::channel(256);
        let service = Arc::new(Self {
            pool,
            resources: RwLock::new(resources::ResourceClient::production()),
            root,
            asset_root,
            state: RwLock::new(AppState {
                phase: AppPhase::Ready,
                runtime_id: uuid::Uuid::new_v4().to_string(),
                workspace_epoch: uuid::Uuid::new_v4().to_string(),
                app_version: env!("CARGO_PKG_VERSION").into(),
                database_version: 2,
                settings_version: 1,
                update_status: UpdateStatus {
                    state: "unavailable".into(),
                    version: None,
                    downloaded: 0.,
                    total: None,
                    reason: Some(ErrorCode::UpdateNotConfigured),
                },
            }),
            connection: RwLock::new(ConnectionState::default()),
            instances: RwLock::new(vec![]),
            settings: Mutex::new(settings),
            store,
            remote: RwLock::new(None),
            events,
            sequence: std::sync::atomic::AtomicU32::new(0),
            maintenance: RwLock::new(()),
            operations: RwLock::new(()),
            changed: tokio::sync::Notify::new(),
            sync_lock: Mutex::new(()),
            submit_lock: Mutex::new(()),
            review_lock: Mutex::new(()),
            detail_lock: tokio::sync::Semaphore::new(1),
        });
        service.resume_local_jobs().await?;
        Ok(service)
    }
    pub async fn emit(&self, kind: &str, key: Option<String>, revision: u32) {
        let state = self.state.read().await;
        let _ = self.events.send(EventEnvelope {
            event_version: 1,
            runtime_id: state.runtime_id.clone(),
            workspace_epoch: state.workspace_epoch.clone(),
            sequence: self
                .sequence
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1,
            revision,
            kind: kind.into(),
            object_key: key,
        });
    }
    pub async fn set_connection(
        self: &Arc<Self>,
        mut c: ConnectionState,
        remote: Option<Remote>,
    ) -> Result<()> {
        self.ready().await?;
        let old = self.connection.read().await.clone();
        let identity_changed = old.player.as_ref().map(|p| &p.player_key)
            != c.player.as_ref().map(|p| &p.player_key)
            || old.instance.as_ref().map(|p| &p.id) != c.instance.as_ref().map(|p| &p.id);
        c.session_epoch = if identity_changed {
            uuid::Uuid::new_v4().to_string()
        } else {
            old.session_epoch.clone()
        };
        if !identity_changed
            && old.phase == ConnectionPhase::CoolingDown
            && old
                .retry_at
                .as_ref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .is_some_and(|d| d > chrono::Utc::now())
        {
            c.phase = ConnectionPhase::CoolingDown;
            c.retry_at = old.retry_at.clone();
        }
        if let Some(p) = &c.player {
            storage::save_player(&self.pool, p).await?;
        }
        *self.remote.write().await = remote;
        *self.connection.write().await = c.clone();
        if identity_changed {
            self.changed.notify_waiters();
        }
        self.emit("connection-changed", None, 0).await;
        if c.phase == ConnectionPhase::Connected {
            self.resume_detail_jobs().await?;
        }
        let settings = self.settings.lock().await.clone();
        if c.phase == ConnectionPhase::Connected
            && settings.auto_sync
            && identity_changed
            && let Some(p) = c.player
        {
            let _ = self
                .start_sync(SyncRequest {
                    player_key: p.player_key,
                    pages: 1,
                })
                .await;
        }
        Ok(())
    }
    pub async fn update_settings(&self, req: UpdateSettings) -> Result<Settings> {
        let _guard = self.maintenance.read().await;
        self.ready().await?;
        let mut current = self.settings.lock().await;
        let next = settings::apply(&current, req)?;
        self.store.save(&next).await?;
        *current = next.clone();
        drop(current);
        self.emit("settings-changed", None, next.revision).await;
        Ok(next)
    }
    pub(super) async fn check_workspace(&self, epoch: &str) -> Result<()> {
        self.ready().await?;
        if self.state.read().await.workspace_epoch != epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        Ok(())
    }
    async fn ready(&self) -> Result<()> {
        if self.state.read().await.phase != AppPhase::Ready {
            Err(AppError::new(ErrorCode::AppNotReady))
        } else {
            Ok(())
        }
    }
    pub async fn start_sync(self: &Arc<Self>, req: SyncRequest) -> Result<Task> {
        let _guard = self.maintenance.read().await;
        self.ready().await?;
        domain::validate_key(&req.player_key)?;
        if !(1..=20).contains(&req.pages) {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let c = self.connection.read().await.clone();
        let p = c
            .player
            .as_ref()
            .filter(|p| p.player_key == req.player_key)
            .ok_or(AppError::new(ErrorCode::Forbidden))?;
        let ident = c
            .identification
            .as_ref()
            .ok_or(AppError::new(ErrorCode::RegionUnknown))?;
        domain::choose_source(ident, c.sgp_ready, false, &p.server_id)?;
        if !matches!(
            c.phase,
            ConnectionPhase::Connected | ConnectionPhase::CoolingDown
        ) {
            return Err(AppError::new(if c.phase == ConnectionPhase::WaitingAuth {
                ErrorCode::WaitingAuth
            } else {
                ErrorCode::ClientNotFound
            }));
        }
        if c.phase == ConnectionPhase::CoolingDown {
            return Err(AppError::new(ErrorCode::RateLimited));
        }
        let _single = self.submit_lock.lock().await;
        if let Some(id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM jobs WHERE player_key=? AND kind='sync' AND state IN ('queued','running')",
        )
        .bind(&req.player_key)
        .fetch_optional(&self.pool)
        .await?
        {
            return storage::task(&self.pool, &id).await;
        }
        let interrupted:Option<String>=sqlx::query_scalar("SELECT id FROM jobs WHERE player_key=? AND kind='sync' AND state='interrupted' AND cancel_requested=0 ORDER BY updated_at DESC LIMIT 1").bind(&req.player_key).fetch_optional(&self.pool).await?;
        if let Some(id) = interrupted {
            sqlx::query("UPDATE jobs SET state='queued',session_epoch=?,error=NULL,budget=MAX(budget,?) WHERE id=?").bind(&c.session_epoch).bind(req.pages).bind(&id).execute(&self.pool).await?;
            let task = storage::task(&self.pool, &id).await?;
            let t = task.clone();
            let service = self.clone();
            tokio::spawn(async move {
                service.run_sync(t).await;
            });
            return Ok(task);
        }
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO jobs(id,player_key,state,checkpoint,budget,session_epoch,updated_at,dedupe_key) VALUES(?,?,'queued',0,?,?,?,?)").bind(&id).bind(&req.player_key).bind(req.pages).bind(&c.session_epoch).bind(storage::now()).bind(&req.player_key).execute(&self.pool).await?;
        let t = storage::task(&self.pool, &id).await?;
        let service = self.clone();
        let task = t.clone();
        tokio::spawn(async move {
            service.run_sync(task).await;
        });
        Ok(t)
    }
    async fn run_sync(self: Arc<Self>, mut task: Task) {
        let _operation = self.operations.read().await;
        let _single = self.sync_lock.lock().await;
        let result: Result<()> = async {
            sqlx::query("UPDATE jobs SET state='running' WHERE id=?")
                .bind(&task.id)
                .execute(&self.pool)
                .await?;
            let conn = self.connection.read().await.clone();
            let player = conn
                .player
                .as_ref()
                .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
            let remote = self
                .remote
                .read()
                .await
                .clone()
                .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
            let ident = conn
                .identification
                .as_ref()
                .ok_or(AppError::new(ErrorCode::RegionUnknown))?;
            let mut source =
                domain::choose_source(ident, conn.sgp_ready, false, &player.server_id)?;
            let mut fallback = None;
            if task.checkpoint > 0 {
                self.checkpoint(&task).await?;
                let raw = self
                    .fetch_page(&remote, player, 0, source.clone(), &task)
                    .await?;
                let items = clients::normalize(&raw, player, source.clone(), None)?;
                let _workspace = self.maintenance.read().await;
                let current = self.connection.read().await;
                if current.session_epoch != task.session_epoch {
                    return Err(AppError::new(ErrorCode::SessionChanged));
                }
                self.checkpoint_cancel(&task).await?;
                storage::commit_page(&self.pool, &task, &items, &raw, false).await?;
            }
            while task.checkpoint < task.budget {
                self.checkpoint(&task).await?;
                // Overlap the previous five summaries so insertions at the remote head do not skip a boundary.
                let offset = if task.checkpoint == 0 {
                    0
                } else {
                    task.checkpoint * 45
                };
                let raw = match self
                    .fetch_page(&remote, player, offset, source.clone(), &task)
                    .await
                {
                    Ok(raw) => raw,
                    Err(e)
                        if matches!(
                            e.code,
                            ErrorCode::EndpointUnsupported | ErrorCode::NetworkUnavailable
                        ) && source == Source::Sgp
                            && conn.lcu_ready =>
                    {
                        source = domain::choose_source(ident, false, true, &player.server_id)?;
                        fallback = Some(format!("{:?}", e.code));
                        self.fetch_page(&remote, player, offset, source.clone(), &task)
                            .await?
                    }
                    Err(e) => return Err(e),
                };
                let items = clients::normalize(&raw, player, source.clone(), fallback.clone())?;
                let exhausted = items.len() < 50;
                task.checkpoint += 1;
                // Hold the identity read lock through commit; a switch waits until this safe checkpoint completes.
                let _workspace = self.maintenance.read().await;
                let current = self.connection.read().await;
                if current.session_epoch != task.session_epoch {
                    return Err(AppError::new(ErrorCode::SessionChanged));
                }
                self.checkpoint_cancel(&task).await?;
                storage::commit_page(&self.pool, &task, &items, &raw, exhausted).await?;
                drop(current);
                self.emit("match-updated", task.player_key.clone(), task.checkpoint)
                    .await;
                self.emit("task-progress", Some(task.id.clone()), task.checkpoint)
                    .await;
                if exhausted {
                    break;
                }
            }
            Ok(())
        }
        .await;
        let (state, error) = match result {
            Ok(()) => ("completed", None),
            Err(mut e) => {
                e.task_id = Some(task.id.clone());
                if e.code == ErrorCode::RateLimited {
                    let mut c = self.connection.write().await;
                    c.phase = ConnectionPhase::CoolingDown;
                    c.retry_at = Some(
                        (chrono::Utc::now()
                            + chrono::Duration::seconds(
                                e.params
                                    .get("retryAfter")
                                    .and_then(|s| s.parse::<i64>().ok())
                                    .unwrap_or(60)
                                    .clamp(1, 3600),
                            ))
                        .to_rfc3339(),
                    );
                }
                (
                    if matches!(e.code, ErrorCode::Cancelled | ErrorCode::SessionChanged) {
                        "cancelled"
                    } else {
                        "failed"
                    },
                    Some(serde_json::to_string(&e).unwrap()),
                )
            }
        };
        let _ = sqlx::query("UPDATE jobs SET state=?,error=?,updated_at=? WHERE id=?")
            .bind(state)
            .bind(error)
            .bind(storage::now())
            .bind(&task.id)
            .execute(&self.pool)
            .await;
        self.emit("task-progress", Some(task.id), task.checkpoint + 1)
            .await;
    }
    async fn checkpoint_cancel(&self, t: &Task) -> Result<()> {
        let cancel: bool = sqlx::query_scalar("SELECT cancel_requested FROM jobs WHERE id=?")
            .bind(&t.id)
            .fetch_one(&self.pool)
            .await?;
        if cancel {
            return Err(AppError::new(ErrorCode::Cancelled));
        }
        Ok(())
    }
    async fn checkpoint(&self, t: &Task) -> Result<()> {
        if self.state.read().await.phase == AppPhase::ShuttingDown {
            return Err(AppError::new(ErrorCode::Cancelled));
        }
        self.ready().await?;
        if self.connection.read().await.session_epoch != t.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        self.checkpoint_cancel(t).await
    }
    pub async fn usage(&self) -> StorageUsage {
        StorageUsage {
            database_bytes: storage::bytes(self.root.join("riftmind.db")).await as f64,
            asset_bytes: storage::bytes(self.asset_root.clone()).await as f64,
            backup_bytes: storage::bytes(self.root.join("backups")).await as f64,
        }
    }
    pub async fn backup(&self) -> Result<MaintenanceResult> {
        let _guard = self.maintenance.write().await;
        self.ready().await?;
        let id = uuid::Uuid::new_v4().to_string();
        let db = self.root.join("backups").join(format!("{id}.db"));
        storage::vacuum_backup(&self.pool, &db).await?;
        let bytes = tokio::fs::read(&db).await?;
        let settings = self.settings.lock().await.clone();
        let data = json!({"schemaVersion":2,"database":STANDARD.encode(&bytes),"sha256":storage::hash(&bytes),"settings":settings});
        let file = self.root.join("backups").join(format!("{id}.riftmind"));
        tokio::fs::write(&file, serde_json::to_vec(&data)?).await?;
        tokio::fs::remove_file(db).await?;
        Ok(MaintenanceResult {
            reference: id,
            workspace_epoch: self.state.read().await.workspace_epoch.clone(),
        })
    }
    pub async fn restore(&self, id: &str) -> Result<MaintenanceResult> {
        domain::validate_key(id)?;
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let file = self.root.join("backups").join(format!("{id}.riftmind"));
        if tokio::fs::metadata(&file).await?.len() > 128 * 1024 * 1024 {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
        let restore_path = self
            .root
            .join("backups")
            .join(format!("restore-{}.db", uuid::Uuid::new_v4()));
        let settings =
            recovery::validate_bundle(&tokio::fs::read(file).await?, &restore_path).await?;
        let rollback = self.backup().await?;
        let _guard = self.maintenance.write().await;
        {
            use tokio::io::AsyncWriteExt;
            let pending = self.root.join("restore-journal.pending");
            let mut file = tokio::fs::File::create(&pending).await?;
            file.write_all(&serde_json::to_vec(
                &json!({"rollbackBackup":rollback.reference}),
            )?)
            .await?;
            file.sync_all().await?;
            drop(file);
            tokio::fs::rename(pending, self.root.join("restore-journal.json")).await?;
        }
        self.state.write().await.phase = AppPhase::Migrating;
        let outcome:Result<()>=async {
   let mut conn=self.pool.acquire().await?;conn.close_on_drop();
   sqlx::query("ATTACH DATABASE ? AS restore_source").bind(restore_path.to_string_lossy().as_ref()).execute(&mut *conn).await?;
   let mut tx=sqlx::Connection::begin(&mut *conn).await?;sqlx::query("PRAGMA defer_foreign_keys=ON").execute(&mut *tx).await?;
   for table in storage::TABLES.iter().rev(){sqlx::query(&format!("DELETE FROM {table}")).execute(&mut *tx).await?;}
   for table in storage::TABLES{sqlx::query(&format!("INSERT INTO {table} SELECT * FROM restore_source.{table}")).execute(&mut *tx).await?;}
   sqlx::query("UPDATE jobs SET state='interrupted',cancel_requested=1 WHERE state IN ('running','queued')").execute(&mut *tx).await?;
   let old=self.settings.lock().await.clone();self.store.save(&settings).await?;
   if let Err(e)=tx.commit().await {self.store.save(&old).await?;return Err(e.into())}
   *self.settings.lock().await=settings;sqlx::query("DETACH DATABASE restore_source").execute(&mut *conn).await?;Ok(())
  }.await;
        if let Err(error) = outcome {
            self.state.write().await.phase = AppPhase::RecoveryRequired;
            self.emit("app-state-changed", None, 0).await;
            return Err(error);
        }
        self.state.write().await.phase = AppPhase::Ready;
        tokio::fs::remove_file(self.root.join("restore-journal.json")).await?;
        let _ = tokio::fs::remove_file(&restore_path).await;
        self.state.write().await.workspace_epoch = uuid::Uuid::new_v4().to_string();
        self.emit("workspace-reset", None, 0).await;
        Ok(MaintenanceResult {
            reference: id.into(),
            workspace_epoch: self.state.read().await.workspace_epoch.clone(),
        })
    }
    pub async fn diagnostics(&self) -> Result<MaintenanceResult> {
        let id = uuid::Uuid::new_v4().to_string();
        let c = self.connection.read().await;
        let data = json!({"app":*self.state.read().await,"connection":{"phase":c.phase,"identification":c.identification,"sgpReady":c.sgp_ready,"lcuReady":c.lcu_ready},"settingsSchema":1,"exportedAt":storage::now()});
        tokio::fs::write(
            self.root
                .join("backups")
                .join(format!("{id}.diagnostics.json")),
            serde_json::to_vec_pretty(&data)?,
        )
        .await?;
        Ok(MaintenanceResult {
            reference: id,
            workspace_epoch: self.state.read().await.workspace_epoch.clone(),
        })
    }
    pub async fn shutdown(&self) -> Result<()> {
        self.state.write().await.phase = AppPhase::ShuttingDown;
        self.changed.notify_waiters();
        sqlx::query("UPDATE jobs SET cancel_requested=1 WHERE state IN ('queued','running')")
            .execute(&self.pool)
            .await?;
        let _operations = self.operations.write().await;
        let _single = self.sync_lock.lock().await;
        self.store.save(&self.settings.lock().await.clone()).await?;
        self.pool.close().await;
        Ok(())
    }
    pub async fn dispatch(self: &Arc<Self>, command: Command) -> Result<Value> {
        macro_rules! out {
            ($e:expr) => {
                Ok(serde_json::to_value($e)?)
            };
        }
        match command {
            Command::get_match_review_data(r) => out!(self.review_data(r).await?),
            Command::fetch_match_details(r) => out!(self.start_details(r).await?),
            Command::generate_review(r) => out!(self.start_review(r).await?),
            Command::get_review(r) => out!(storage::review::report(&self.pool, &r.id).await?),
            Command::get_review_evidence(r) => {
                out!(storage::review::evidence(&self.pool, r).await?)
            }
            Command::get_timeline_slice(r) => out!(self.timeline_slice(r).await?),
            Command::get_match_metrics(r) => out!(self.match_metrics(r).await?),
            Command::get_review_annotations(r) => {
                out!(storage::review::annotations(&self.pool, r).await?)
            }
            Command::save_review_note(r) => {
                let _guard = self.maintenance.read().await;
                self.check_workspace(&r.workspace_epoch).await?;
                let n = storage::review::save_note(&self.pool, r).await?;
                self.emit("annotations-changed", Some(n.match_key.clone()), n.revision)
                    .await;
                out!(n)
            }
            Command::delete_review_note(r) => {
                let _guard = self.maintenance.read().await;
                self.check_workspace(&r.workspace_epoch).await?;
                let n = storage::review::delete_note(&self.pool, r).await?;
                self.emit("annotations-changed", None, 0).await;
                out!(n)
            }
            Command::save_review_feedback(r) => {
                let _guard = self.maintenance.read().await;
                self.check_workspace(&r.workspace_epoch).await?;
                let n = storage::review::feedback(&self.pool, r).await?;
                self.emit("annotations-changed", Some(n.report_id.clone()), n.revision)
                    .await;
                out!(n)
            }
            Command::save_training_goal(r) => out!(self.save_goal(r).await?),
            Command::list_training_goals(r) => out!(self.list_goals(r).await?),
            Command::get_goal_progress(r) => out!(self.goal_progress(r).await?),
            Command::evaluate_training_goal(r) => out!(self.start_evaluation(&r.id).await?),
            Command::get_player_progress(r) => out!(self.player_progress(r).await?),
            Command::get_app_state(_) => out!(self.state.read().await.clone()),
            Command::get_settings(_) => out!(self.settings.lock().await.clone()),
            Command::update_settings(r) => out!(self.update_settings(r).await?),
            Command::get_connection_state(_) => out!(self.connection.read().await.clone()),
            Command::list_client_instances(_) => out!(self.instances.read().await.clone()),
            Command::retry_connection(_) => {
                self.connection.write().await.phase = ConnectionPhase::Discovering;
                self.emit("connection-retry", None, 0).await;
                out!(self.connection.read().await.clone())
            }
            Command::select_client_instance(r) => {
                domain::validate_key(&r.id)?;
                let i = self
                    .instances
                    .read()
                    .await
                    .iter()
                    .find(|i| i.id == r.id)
                    .cloned()
                    .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
                let mut connection = self.connection.write().await;
                connection.instance = Some(i.clone());
                connection.identification = Some(i.identification);
                connection.player = None;
                connection.sgp_ready = false;
                connection.lcu_ready = false;
                connection.phase = ConnectionPhase::Discovering;
                connection.session_epoch = uuid::Uuid::new_v4().to_string();
                drop(connection);
                self.changed.notify_waiters();
                self.emit("connection-retry", None, 0).await;
                out!(self.connection.read().await.clone())
            }
            Command::list_players(_) => out!(storage::players(&self.pool).await?),
            Command::list_matches(r) => out!(storage::list(&self.pool, r).await?),
            Command::sync_player_matches(r) => out!(self.start_sync(r).await?),
            Command::get_task_status(r) => out!(storage::task(&self.pool, &r.id).await?),
            Command::cancel_task(r) => {
                domain::validate_key(&r.id)?;
                if matches!(
                    storage::task(&self.pool, &r.id).await?.kind,
                    JobKind::Backup | JobKind::Restore | JobKind::Diagnostics
                ) {
                    return Err(AppError::new(ErrorCode::EndpointUnsupported));
                }
                sqlx::query("UPDATE jobs SET cancel_requested=1 WHERE id=? AND state IN ('queued','running')").bind(&r.id).execute(&self.pool).await?;
                self.changed.notify_waiters();
                out!(storage::task(&self.pool, &r.id).await?)
            }
            Command::get_storage_usage(_) => out!(self.usage().await),
            Command::clear_asset_cache(_) => {
                let _guard = self.maintenance.write().await;
                let mut resources = self.resources.write().await;
                tokio::fs::remove_dir_all(&self.asset_root).await?;
                resources::prepare_directory(&self.asset_root).await?;
                resources.reset_failures().await;
                sqlx::query("UPDATE resource_manifests SET availability='missing',path=NULL")
                    .execute(&self.pool)
                    .await?;
                self.emit("assets-ready", None, 0).await;
                out!(self.usage().await)
            }
            Command::create_backup(_) => out!(self.start_maintenance(JobKind::Backup, None).await?),
            Command::restore_backup(r) => {
                out!(self.start_maintenance(JobKind::Restore, Some(r.id)).await?)
            }
            Command::export_diagnostics(_) => {
                out!(self.start_maintenance(JobKind::Diagnostics, None).await?)
            }
            Command::resolve_assets(r) => out!(
                self.resources
                    .read()
                    .await
                    .resolve(&self.pool, &self.asset_root, r)
                    .await?
            ),
            Command::check_for_updates(_) | Command::install_update(_) => out!(UpdateStatus {
                state: "unavailable".into(),
                version: None,
                downloaded: 0.,
                total: None,
                reason: Some(ErrorCode::UpdateNotConfigured)
            }),
        }
    }
}

impl Service {
    pub async fn start_maintenance(
        self: &Arc<Self>,
        kind: JobKind,
        reference: Option<String>,
    ) -> Result<Task> {
        self.ready().await?;
        if !matches!(
            kind,
            JobKind::Backup | JobKind::Restore | JobKind::Diagnostics
        ) {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        if kind == JobKind::Restore {
            let id = reference
                .as_deref()
                .ok_or(AppError::new(ErrorCode::InvalidInput))?;
            if uuid::Uuid::parse_str(id).is_err() {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let epoch = self.state.read().await.workspace_epoch.clone();
        let kind_json = serde_json::to_value(&kind)?.as_str().unwrap().to_string();
        sqlx::query("INSERT INTO jobs(id,state,checkpoint,budget,session_epoch,updated_at,kind) VALUES(?,'queued',0,1,?,?,?)").bind(&id).bind(&epoch).bind(storage::now()).bind(&kind_json).execute(&self.pool).await?;
        let task = storage::task(&self.pool, &id).await?;
        let service = self.clone();
        let task_id = id.clone();
        tokio::spawn(async move {
            let _operation = service.operations.read().await;
            let _ = sqlx::query("UPDATE jobs SET state='running' WHERE id=?")
                .bind(&task_id)
                .execute(&service.pool)
                .await;
            let result = match kind {
                JobKind::Backup => service.backup().await,
                JobKind::Restore => service.restore(reference.as_deref().unwrap()).await,
                JobKind::Diagnostics => service.diagnostics().await,
                _ => unreachable!(),
            };
            let (state, error, result) = match result {
                Ok(r) => ("completed", None, Some(serde_json::to_string(&r).unwrap())),
                Err(mut e) => {
                    e.task_id = Some(task_id.clone());
                    ("failed", Some(serde_json::to_string(&e).unwrap()), None)
                }
            };
            let _=sqlx::query("INSERT INTO jobs(id,state,checkpoint,budget,session_epoch,updated_at,kind,error,result) VALUES(?,?,1,1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,checkpoint=1,error=excluded.error,result=excluded.result,updated_at=excluded.updated_at").bind(&task_id).bind(state).bind(epoch).bind(storage::now()).bind(kind_json).bind(error).bind(result).execute(&service.pool).await;
            service.emit("task-progress", Some(task_id), 1).await;
        });
        Ok(task)
    }
    pub async fn await_task(&self, id: &str) -> Result<MaintenanceResult> {
        loop {
            let task = storage::task(&self.pool, id).await?;
            match task.state {
                JobState::Completed => {
                    return task.result.ok_or(AppError::new(ErrorCode::NotFound));
                }
                JobState::Failed | JobState::Cancelled | JobState::Interrupted => {
                    return Err(task.error.unwrap_or(AppError::new(ErrorCode::Cancelled)));
                }
                _ => tokio::time::sleep(std::time::Duration::from_millis(50)).await,
            }
        }
    }
}

impl Service {
    async fn fetch_page(
        &self,
        remote: &Remote,
        player: &Player,
        offset: u32,
        source: Source,
        task: &Task,
    ) -> Result<Value> {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            self.checkpoint(task).await?;
            tokio::select! {result=remote.page(player,offset,source.clone())=>return result,_=changed=>{self.checkpoint(task).await?;}}
        }
    }
}
