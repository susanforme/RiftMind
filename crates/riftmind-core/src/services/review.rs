use super::*;
use crate::{domain::analysis, storage::review as db};
use sqlx::Row;
impl Service {
    pub(super) async fn resume_local_jobs(self: &Arc<Self>) -> Result<()> {
        let rows:Vec<(String,String)>=sqlx::query_as("SELECT kind,request FROM jobs WHERE state='interrupted' AND cancel_requested=0 AND preparation_id IS NULL AND request IS NOT NULL AND kind IN ('generate_review','evaluate_goal') ORDER BY updated_at,id LIMIT 100").fetch_all(&self.pool).await?;
        for (kind, request) in rows {
            if kind == "generate_review" {
                if let Ok(r) = serde_json::from_str(&request) {
                    let _ = self.start_review(r).await;
                }
            } else if let Ok(r) = serde_json::from_str::<IdInput>(&request) {
                let _ = self.start_evaluation(&r.id).await;
            }
        }
        Ok(())
    }
    pub(super) async fn resume_detail_jobs(self: &Arc<Self>) -> Result<()> {
        let player = self
            .connection
            .read()
            .await
            .player
            .as_ref()
            .map(|p| p.player_key.clone());
        if let Some(player) = player {
            let rows:Vec<String>=sqlx::query_scalar("SELECT request FROM jobs WHERE player_key=? AND state='interrupted' AND cancel_requested=0 AND preparation_id IS NULL AND request IS NOT NULL AND kind='fetch_details' ORDER BY updated_at,id LIMIT 100").bind(player).fetch_all(&self.pool).await?;
            for request in rows {
                if let Ok(q) = serde_json::from_str(&request) {
                    let _ = self.start_details(q).await;
                }
            }
        }
        Ok(())
    }
    pub async fn review_data(&self, q: ReviewQuery) -> Result<ReviewData> {
        let key = MatchRef {
            match_key: q.match_key,
            player_key: q.player_key,
        };
        let summary = db::summary(&self.pool, &key).await?;
        let current = db::input(&self.pool, &key, None).await?;
        let mut input = if let Some(rev) = q.input_revision {
            Some(db::required_input(&self.pool, &key, rev).await?)
        } else {
            current.clone()
        };
        let report = if let Some(id) = q.report_id {
            let r = db::report(&self.pool, &id).await?;
            if r.match_key != key.match_key
                || r.player_key != key.player_key
                || q.input_revision.is_some_and(|n| n != r.input_revision)
            {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            input = Some(db::required_input(&self.pool, &key, r.input_revision).await?);
            Some(r)
        } else {
            if let Some(revision) = q.input_revision {
                let payload:Option<String>=sqlx::query_scalar("SELECT r.payload FROM reviews r JOIN analysis_inputs i ON i.id=r.input_id WHERE r.match_key=? AND r.player_key=? AND i.revision=? ORDER BY r.revision DESC LIMIT 1").bind(&key.match_key).bind(&key.player_key).bind(revision).fetch_optional(&self.pool).await?;
                payload.map(|s| serde_json::from_str(&s)).transpose()?
            } else {
                db::latest_report(&self.pool, &key).await?
            }
        };
        let attempt =
            sqlx::query("SELECT * FROM detail_attempts WHERE match_key=? AND player_key=?")
                .bind(&key.match_key)
                .bind(&key.player_key)
                .fetch_optional(&self.pool)
                .await?;
        let active_id:Option<String>=sqlx::query_scalar("SELECT id FROM jobs WHERE player_key=? AND dedupe_key LIKE ? AND kind IN ('fetch_details','generate_review') AND state IN ('queued','running') ORDER BY updated_at DESC LIMIT 1").bind(&key.player_key).bind(format!("{}|{}|%",key.match_key,key.player_key)).fetch_optional(&self.pool).await?;
        let active_task = if let Some(id) = active_id {
            Some(storage::task(&self.pool, &id).await?)
        } else {
            None
        };
        let summary_status = input
            .as_ref()
            .and_then(|i| i.capabilities.get("summary"))
            .map(|c| c.status.clone())
            .unwrap_or(DataStatus::Partial);
        let timeline_status = input
            .as_ref()
            .and_then(|i| i.capabilities.get("timeline"))
            .filter(|c| matches!(c.status, DataStatus::Ready | DataStatus::Partial))
            .map(|c| c.status.clone())
            .unwrap_or_else(|| {
                attempt
                    .as_ref()
                    .and_then(|r| {
                        serde_json::from_value(Value::String(r.get("timeline_status"))).ok()
                    })
                    .unwrap_or(DataStatus::Missing)
            });
        let newer_input = report.as_ref().is_some_and(|r| {
            current
                .as_ref()
                .is_some_and(|i| r.input_fingerprint != i.fingerprint)
                || r.rule_version != analysis::RULES
        });
        let latest_input_revision = current.as_ref().map(|i| i.revision);
        if let Some(r) = &report {
            input = Some(db::required_input(&self.pool, &key, r.input_revision).await?);
        }
        // IPC returns metadata only; chart and event bodies have separate bounded commands.
        if let Some(i) = input.as_mut() {
            i.frames.clear();
            i.events.clear();
        }
        Ok(ReviewData {
            summary,
            input,
            report,
            summary_status,
            timeline_status,
            retry_at: attempt.as_ref().and_then(|r| r.get("retry_at")),
            last_error: attempt
                .and_then(|r| r.get::<Option<String>, _>("error"))
                .map(|s| serde_json::from_str(&s))
                .transpose()?,
            active_task,
            newer_input,
            latest_input_revision,
        })
    }
    pub async fn timeline_slice(&self, q: TimelineQuery) -> Result<TimelineSlice> {
        if q.kinds.len() > 16
            || q.kinds.iter().any(|k| k.len() > 100)
            || q.from_ms > q.to_ms
            || q.limit.is_some_and(|n| !(1..=500).contains(&n))
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let input = db::required_input(
            &self.pool,
            &MatchRef {
                match_key: q.match_key,
                player_key: q.player_key,
            },
            q.input_revision,
        )
        .await?;
        if q.to_ms > input.context.duration_ms.saturating_add(60000) {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let limit = q.limit.unwrap_or(100) as usize;
        let cursor = q.cursor.unwrap_or(0) as usize;
        let filtered: Vec<_> = input
            .events
            .into_iter()
            .filter(|e| {
                e.timestamp_ms >= q.from_ms
                    && e.timestamp_ms <= q.to_ms
                    && (q.kinds.is_empty() || q.kinds.contains(&e.kind))
            })
            .collect();
        if cursor > filtered.len() {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        Ok(TimelineSlice {
            events: filtered.iter().skip(cursor).take(limit).cloned().collect(),
            next_cursor: (cursor + limit < filtered.len()).then_some((cursor + limit) as u32),
            capabilities: input.capabilities,
        })
    }
    pub async fn match_metrics(&self, q: ChartQuery) -> Result<ChartData> {
        let input = db::required_input(
            &self.pool,
            &MatchRef {
                match_key: q.match_key,
                player_key: q.player_key,
            },
            q.input_revision,
        )
        .await?;
        analysis::chart(&input, q.from_ms, q.to_ms, q.max_points)
    }
    pub(super) async fn submit_review_job(
        &self,
        kind: &str,
        key: &str,
        player: &str,
        request: Value,
        epoch: &str,
        preparation_id: Option<&str>,
    ) -> Result<Task> {
        if let Some(id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM jobs WHERE kind=? AND dedupe_key=? AND state IN ('queued','running')",
        )
        .bind(kind)
        .bind(key)
        .fetch_optional(&self.pool)
        .await?
        {
            return storage::task(&self.pool, &id).await;
        }
        let interrupted:Option<String>=sqlx::query_scalar("SELECT id FROM jobs WHERE kind=? AND dedupe_key=? AND state='interrupted' AND cancel_requested=0 ORDER BY updated_at DESC LIMIT 1").bind(kind).bind(key).fetch_optional(&self.pool).await?;
        let id = interrupted.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        sqlx::query("INSERT INTO jobs(id,player_key,state,checkpoint,budget,session_epoch,updated_at,kind,dedupe_key,request,stage,preparation_id) VALUES(?,?,'queued',0,2,?,?,?,?,?,'queued',?) ON CONFLICT(id) DO UPDATE SET state='queued',session_epoch=excluded.session_epoch,error=NULL,request=excluded.request").bind(&id).bind(player).bind(epoch).bind(storage::now()).bind(kind).bind(key).bind(serde_json::to_string(&request)?).bind(preparation_id).execute(&self.pool).await?;
        storage::task(&self.pool, &id).await
    }
    pub async fn start_details(self: &Arc<Self>, q: MatchRef) -> Result<Task> {
        self.start_details_in_workspace(q, None, None, None).await
    }
    pub(super) async fn start_details_in_workspace(
        self: &Arc<Self>,
        q: MatchRef,
        epoch: Option<&str>,
        session: Option<&str>,
        preparation_id: Option<&str>,
    ) -> Result<Task> {
        let _workspace = self.maintenance.read().await;
        if let Some(epoch) = epoch {
            self.check_workspace(epoch).await?;
        }
        if session.is_some_and(|expected| {
            !self
                .connection
                .try_read()
                .is_ok_and(|connection| connection.session_epoch == expected)
        }) {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        self.ready().await?;
        let m = db::summary(&self.pool, &q).await?;
        let c = self.connection.read().await.clone();
        let p = c
            .player
            .as_ref()
            .filter(|p| p.player_key == q.player_key && p.server_id == m.server_id)
            .ok_or(AppError::new(ErrorCode::Forbidden))?;
        if c.phase != ConnectionPhase::Connected {
            return Err(AppError::new(if c.phase == ConnectionPhase::WaitingAuth {
                ErrorCode::WaitingAuth
            } else if c.phase == ConnectionPhase::CoolingDown {
                ErrorCode::RateLimited
            } else {
                ErrorCode::ClientNotFound
            }));
        }
        if c.identification
            .as_ref()
            .and_then(|i| i.server_id.as_deref())
            != Some(m.server_id.as_str())
        {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
        domain::choose_source(
            c.identification
                .as_ref()
                .ok_or(AppError::new(ErrorCode::RegionUnknown))?,
            c.sgp_ready,
            false,
            &p.server_id,
        )?;
        let retry: Option<String> = sqlx::query_scalar(
            "SELECT retry_at FROM detail_attempts WHERE match_key=? AND player_key=?",
        )
        .bind(&q.match_key)
        .bind(&q.player_key)
        .fetch_optional(&self.pool)
        .await?
        .flatten();
        if retry
            .as_ref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_some_and(|t| t > chrono::Utc::now())
        {
            let mut e = AppError::new(ErrorCode::RateLimited);
            e.params.insert("retryAt".into(), retry.unwrap());
            return Err(e);
        }
        let _submit = self.submit_lock.lock().await;
        let key = format!("{}|{}|details", q.match_key, q.player_key);
        if let Some(id)=sqlx::query_scalar::<_,String>("SELECT id FROM jobs WHERE kind='fetch_details' AND dedupe_key=? AND state IN ('queued','running')").bind(&key).fetch_optional(&self.pool).await?{return storage::task(&self.pool,&id).await}
        let task = self
            .submit_review_job(
                "fetch_details",
                &key,
                &q.player_key,
                serde_json::to_value(&q)?,
                &c.session_epoch,
                preparation_id,
            )
            .await?;
        sqlx::query("INSERT INTO detail_attempts VALUES(?,?,'pending','pending',NULL,NULL) ON CONFLICT(match_key,player_key) DO UPDATE SET summary_status='pending',timeline_status='pending',error=NULL").bind(&q.match_key).bind(&q.player_key).execute(&self.pool).await?;
        let s = self.clone();
        let t = task.clone();
        let epoch = self.state.read().await.workspace_epoch.clone();
        tokio::spawn(async move {
            s.run_details(t, q, epoch).await;
        });
        Ok(task)
    }
    async fn fetch_single(
        &self,
        remote: &Remote,
        m: &MatchSummary,
        timeline: bool,
        c: &ConnectionState,
        t: &Task,
    ) -> Result<(Value, Source)> {
        self.checkpoint(t).await?;
        let changed = self.changed.notified();
        tokio::pin!(changed);
        changed.as_mut().enable();
        let result = tokio::select! {r=remote.single(m,timeline,Source::Sgp)=>r,_=changed=>{self.checkpoint(t).await?;return Err(AppError::new(ErrorCode::SessionChanged))}};
        match result {
            Ok(v) => Ok((v, Source::Sgp)),
            Err(e)
                if matches!(
                    e.code,
                    ErrorCode::EndpointUnsupported | ErrorCode::NetworkUnavailable
                ) && c.lcu_ready
                    && (!timeline || remote.lcu_timeline_equivalent()) =>
            {
                domain::choose_source(
                    c.identification
                        .as_ref()
                        .ok_or(AppError::new(ErrorCode::RegionUnknown))?,
                    false,
                    true,
                    &m.server_id,
                )?;
                Ok((remote.single(m, timeline, Source::Lcu).await?, Source::Lcu))
            }
            Err(e) => Err(e),
        }
    }
    async fn run_details(self: Arc<Self>, task: Task, q: MatchRef, workspace_epoch: String) {
        let _op = self.operations.read().await;
        let _permit = self.detail_lock.acquire().await.unwrap();
        let result:Result<String>=async {
            self.check_workspace(&workspace_epoch).await?;self.checkpoint(&task).await?;self.job_stage(&task,"summary",0).await?;
            let mut m=db::summary(&self.pool,&q).await?;let c=self.connection.read().await.clone();let remote=self.remote.read().await.clone().ok_or(AppError::new(ErrorCode::ClientNotFound))?;
            let player=c.player.as_ref().filter(|p|p.player_key==q.player_key&&p.server_id==m.server_id).ok_or(AppError::new(ErrorCode::Forbidden))?;
            let previous=db::input(&self.pool,&q,None).await?;
            let cached=if let Some(i)=previous.as_ref(){Some(db::snapshot(&self.pool,&i.summary_snapshot).await?)}else{db::cached_summary(&self.pool,&m).await?};
            let valid=cached.as_ref().and_then(|v|analysis::normalize(v,None,&m,&player.puuid).ok()).is_some_and(|i|i.capabilities["summary"].status==DataStatus::Ready);
            let summary=if valid{cached.unwrap()}else{let (v,source)=self.fetch_single(&remote,&m,false,&c,&task).await?;m.source=source;v};
            let mut refreshed=clients::normalize(&json!({"games":[summary.clone()]}),player,m.source.clone(),m.fallback_reason.clone())?.remove(0);
            refreshed.started_at=m.started_at.clone();
            m=refreshed;
            // Commit valid settlement before timeline I/O, so failure/cancellation retains it.
            let normalized=analysis::normalize(&summary,None,&m,&player.puuid)?;
            {let _workspace=self.maintenance.read().await;self.check_workspace(&workspace_epoch).await?;let current=self.connection.read().await;if current.session_epoch!=task.session_epoch{return Err(AppError::new(ErrorCode::SessionChanged))}self.checkpoint_cancel(&task).await?;
                let mut tx=self.pool.begin().await?;
                if previous.as_ref().is_none_or(|i|i.timeline_snapshot.is_none()) {let saved=db::save_input_tx(&mut tx,normalized,&m,&summary,None,&m.source).await?;m=db::refresh_settlement_tx(&mut tx,m,&saved).await?;}
                sqlx::query("UPDATE jobs SET checkpoint=1,stage='timeline' WHERE id=?").bind(&task.id).execute(&mut *tx).await?;tx.commit().await?;
            }
            self.emit("review-data-changed",Some(q.match_key.clone()),1).await;self.job_stage(&task,"timeline",1).await?;
            let (timeline,source)=self.fetch_single(&remote,&m,true,&c,&task).await?;
            let normalized=analysis::normalize(&summary,Some(&timeline),&m,&player.puuid)?;
            let _workspace=self.maintenance.read().await;self.check_workspace(&workspace_epoch).await?;let current=self.connection.read().await;if current.session_epoch!=task.session_epoch{return Err(AppError::new(ErrorCode::SessionChanged))}self.checkpoint_cancel(&task).await?;
            let mut tx=self.pool.begin().await?;let i=db::save_input_tx(&mut tx,normalized,&m,&summary,Some(&timeline),&source).await?;
            let ss=serde_json::to_value(&i.capabilities["summary"].status)?.as_str().unwrap().to_owned();let ts=serde_json::to_value(&i.capabilities["timeline"].status)?.as_str().unwrap().to_owned();
            sqlx::query("UPDATE detail_attempts SET summary_status=?,timeline_status=?,error=NULL,retry_at=NULL WHERE match_key=? AND player_key=?").bind(ss).bind(ts).bind(&q.match_key).bind(&q.player_key).execute(&mut *tx).await?;
            self.finish_job_tx(&mut tx,&task,&i.id).await?;tx.commit().await?;Ok(i.id)
        }.await;
        let _workspace = self.maintenance.read().await;
        if self.state.read().await.workspace_epoch != workspace_epoch {
            return;
        }
        if let Err(e) = &result {
            let seconds = e
                .params
                .get("retryAfter")
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(30)
                .clamp(1, 3600);
            let retry = if matches!(
                e.code,
                ErrorCode::Cancelled | ErrorCode::SessionChanged | ErrorCode::AppNotReady
            ) {
                None
            } else {
                Some((chrono::Utc::now() + chrono::Duration::seconds(seconds)).to_rfc3339())
            };
            let state = if e.code == ErrorCode::EndpointUnsupported {
                "unsupported"
            } else {
                "failed"
            };
            let _=sqlx::query("UPDATE detail_attempts SET summary_status=CASE WHEN EXISTS(SELECT 1 FROM analysis_inputs WHERE match_key=? AND player_key=?) THEN 'partial' ELSE 'failed' END,timeline_status=?,error=?,retry_at=? WHERE match_key=? AND player_key=?").bind(&q.match_key).bind(&q.player_key).bind(state).bind(serde_json::to_string(e).unwrap()).bind(retry).bind(&q.match_key).bind(&q.player_key).execute(&self.pool).await;
        }
        self.finish_job(&task, result).await;
        self.emit("review-data-changed", Some(q.match_key), 0).await;
    }
    pub async fn start_review(self: &Arc<Self>, q: GenerateReview) -> Result<Task> {
        self.start_review_in_workspace(q, None, None).await
    }
    pub(super) async fn start_review_in_workspace(
        self: &Arc<Self>,
        q: GenerateReview,
        epoch: Option<&str>,
        preparation_id: Option<&str>,
    ) -> Result<Task> {
        let _workspace = self.maintenance.read().await;
        if let Some(epoch) = epoch {
            self.check_workspace(epoch).await?;
        }
        self.ready().await?;
        let key = MatchRef {
            match_key: q.match_key.clone(),
            player_key: q.player_key.clone(),
        };
        let i = db::required_input(&self.pool, &key, q.input_revision).await?;
        if !analysis::supported(&i.context) {
            return Err(AppError::new(ErrorCode::AnalysisUnsupported));
        }
        let dedupe = format!(
            "{}|{}|{}|{}|{}",
            q.match_key,
            q.player_key,
            i.fingerprint,
            analysis::RULES,
            self.state.read().await.workspace_epoch
        );
        let _submit = self.submit_lock.lock().await;
        if let Some(id)=sqlx::query_scalar::<_,String>("SELECT id FROM jobs WHERE kind='generate_review' AND dedupe_key=? AND state IN ('queued','running','completed') ORDER BY updated_at DESC LIMIT 1").bind(&dedupe).fetch_optional(&self.pool).await?{return storage::task(&self.pool,&id).await}
        let task = self
            .submit_review_job(
                "generate_review",
                &dedupe,
                &q.player_key,
                serde_json::to_value(&q)?,
                &self.state.read().await.workspace_epoch,
                preparation_id,
            )
            .await?;
        let s = self.clone();
        let t = task.clone();
        tokio::spawn(async move {
            let _op = s.operations.read().await;
            let _single = s.review_lock.lock().await;
            let result:Result<String>=async {
                s.local_checkpoint(&t).await?;s.job_stage(&t,"compute",0).await?;
                let mut r=tokio::task::spawn_blocking(move||analysis::report(&i)).await.map_err(|_|AppError::new(ErrorCode::InvalidInput))??;
                s.local_checkpoint(&t).await?;let _workspace=s.maintenance.read().await;s.local_checkpoint(&t).await?;
                let mut tx=s.pool.begin().await?;
                let input_id:String=sqlx::query_scalar("SELECT id FROM analysis_inputs WHERE fingerprint=? AND match_key=? AND player_key=?").bind(&r.input_fingerprint).bind(&r.match_key).bind(&r.player_key).fetch_one(&mut *tx).await?;
                let existing:Option<String>=sqlx::query_scalar("SELECT id FROM reviews WHERE input_id=? AND rule_version=?").bind(&input_id).bind(analysis::RULES).fetch_optional(&mut *tx).await?;
                if let Some(id)=existing{s.finish_job_tx(&mut tx,&t,&id).await?;tx.commit().await?;return Ok(id)}
                r.id=uuid::Uuid::new_v4().to_string();r.revision=sqlx::query_scalar::<_,i64>("SELECT COALESCE(MAX(revision),0)+1 FROM reviews WHERE match_key=? AND player_key=?").bind(&r.match_key).bind(&r.player_key).fetch_one(&mut *tx).await? as u32;r.generated_at=storage::now();
                sqlx::query("INSERT INTO reviews VALUES(?,?,?,?,?,?,?)").bind(&r.id).bind(&r.match_key).bind(&r.player_key).bind(input_id).bind(r.revision).bind(&r.rule_version).bind(serde_json::to_string(&r)?).execute(&mut *tx).await?;
                s.finish_job_tx(&mut tx,&t,&r.id).await?;tx.commit().await?;Ok(r.id)
            }.await;
            let _workspace = s.maintenance.read().await;
            if s.state.read().await.workspace_epoch != t.session_epoch {
                return;
            }
            let player = t.player_key.clone();
            let report_id = result.as_ref().ok().cloned();
            s.finish_job(&t, result).await;
            s.emit("review-changed", player.clone(), 0).await;
            drop(_workspace);
            if let (Some(player), Some(report_id)) = (player, report_id) {
                let _ = s
                    .evaluate_active(&player, &report_id, &t.session_epoch)
                    .await;
            }
        });
        Ok(task)
    }
    pub(super) async fn job_stage(&self, t: &Task, stage: &str, checkpoint: u32) -> Result<()> {
        sqlx::query("UPDATE jobs SET state='running',stage=?,checkpoint=?,updated_at=? WHERE id=?")
            .bind(stage)
            .bind(checkpoint)
            .bind(storage::now())
            .bind(&t.id)
            .execute(&self.pool)
            .await?;
        self.emit("task-progress", Some(t.id.clone()), checkpoint)
            .await;
        Ok(())
    }
    pub(super) async fn local_checkpoint(&self, t: &Task) -> Result<()> {
        self.ready().await?;
        if self.state.read().await.workspace_epoch != t.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        self.checkpoint_cancel(t).await
    }
    pub(super) async fn finish_job_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        t: &Task,
        id: &str,
    ) -> Result<()> {
        let result = MaintenanceResult {
            reference: id.into(),
            workspace_epoch: self.state.read().await.workspace_epoch.clone(),
        };
        sqlx::query("UPDATE jobs SET state='completed',checkpoint=budget,stage='completed',result=?,updated_at=? WHERE id=?").bind(serde_json::to_string(&result)?).bind(storage::now()).bind(&t.id).execute(&mut **tx).await?;
        Ok(())
    }
    pub(super) async fn finish_job(&self, t: &Task, result: Result<String>) {
        if let Err(mut e) = result {
            e.task_id = Some(t.id.clone());
            let state = if matches!(e.code, ErrorCode::Cancelled | ErrorCode::SessionChanged) {
                "cancelled"
            } else {
                "failed"
            };
            let _ = sqlx::query("UPDATE jobs SET state=?,stage=?,error=?,updated_at=? WHERE id=?")
                .bind(state)
                .bind(state)
                .bind(serde_json::to_string(&e).unwrap())
                .bind(storage::now())
                .bind(&t.id)
                .execute(&self.pool)
                .await;
        }
        self.emit("task-progress", Some(t.id.clone()), 3).await;
    }
}
