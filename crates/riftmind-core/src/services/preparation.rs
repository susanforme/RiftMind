use super::*;
use crate::{domain::analysis, storage::review as db};
use std::collections::BTreeSet;

impl Service {
    pub async fn list_preparations(&self) -> Result<Vec<PreparationBatch>> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        let rows:Vec<String>=sqlx::query_scalar("SELECT payload FROM preparation_batches ORDER BY json_extract(payload,'$.updatedAt') DESC,id DESC LIMIT 100").fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|payload| serde_json::from_str(&payload).map_err(AppError::from))
            .collect()
    }
    pub async fn preview_preparation(
        &self,
        query: PrepareMatchesQuery,
    ) -> Result<PreparationBatch> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        domain::validate_key(&query.player_key)?;
        if query.match_keys.is_empty()
            || query.match_keys.len() > 20
            || query.match_keys.iter().collect::<BTreeSet<_>>().len() != query.match_keys.len()
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let connection = self.connection.read().await.clone();
        let mut members = Vec::new();
        for match_key in query.match_keys {
            let key = MatchRef {
                match_key: match_key.clone(),
                player_key: query.player_key.clone(),
            };
            let summary = db::summary(&self.pool, &key).await?;
            let input = db::input(&self.pool, &key, None).await?;
            let report: Option<String> = if let Some(input) = &input {
                sqlx::query_scalar("SELECT id FROM reviews WHERE match_key=? AND player_key=? AND input_id=? AND rule_version=? ORDER BY revision DESC LIMIT 1").bind(&match_key).bind(&query.player_key).bind(&input.id).bind(analysis::RULES).fetch_optional(&self.pool).await?
            } else {
                None
            };
            let accessible = connection.phase == ConnectionPhase::Connected
                && connection
                    .player
                    .as_ref()
                    .is_some_and(|player| player.player_key == query.player_key);
            let supported = input
                .as_ref()
                .is_some_and(|input| analysis::supported(&input.context));
            let details = if input
                .as_ref()
                .is_some_and(|input| input.timeline_snapshot.is_some())
            {
                "cached"
            } else if accessible {
                "required"
            } else if input.is_some() {
                "partial"
            } else {
                "unavailable"
            };
            members.push(PreparationMember {
                match_key,
                details: details.into(),
                report: if report.is_some() && !query.recompute {
                    "existing"
                } else if supported {
                    "ready"
                } else if summary.outcome == Outcome::Remake {
                    "not_applicable"
                } else if accessible {
                    "pending_details"
                } else {
                    "unavailable"
                }
                .into(),
                input_revision: input.map(|input| input.revision),
                report_id: report,
                error: None,
            });
        }
        Ok(PreparationBatch {
            id: query
                .batch_id
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            player_key: query.player_key,
            workspace_epoch: query.workspace_epoch,
            session_epoch: connection.session_epoch,
            state: "preview".into(),
            cancel_requested: false,
            members,
            updated_at: storage::now(),
        })
    }
    pub async fn start_preparation(
        self: &Arc<Self>,
        query: PrepareMatchesQuery,
    ) -> Result<PreparationBatch> {
        if let Some(id) = query.batch_id {
            return self
                .change_preparation(PreparationChange {
                    workspace_epoch: query.workspace_epoch,
                    id,
                    action: "resume".into(),
                })
                .await;
        }
        let _single = self.preparation_lock.lock().await;
        let mut batch = self.preview_preparation(query).await?;
        let existing = self
            .list_preparations()
            .await?
            .into_iter()
            .find(|candidate| {
                candidate.workspace_epoch == batch.workspace_epoch
                    && candidate.player_key == batch.player_key
                    && ["queued", "running"].contains(&candidate.state.as_str())
                    && candidate
                        .members
                        .iter()
                        .map(|member| &member.match_key)
                        .eq(batch.members.iter().map(|member| &member.match_key))
            });
        if let Some(existing) = existing {
            return Ok(existing);
        }
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&batch.workspace_epoch).await?;
        batch.state = "queued".into();
        self.persist_preparation(&batch).await?;
        self.spawn_preparation(batch.clone());
        Ok(batch)
    }
    pub async fn change_preparation(
        self: &Arc<Self>,
        query: PreparationChange,
    ) -> Result<PreparationBatch> {
        let _single = self.preparation_lock.lock().await;
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        let mut batch: PreparationBatch = db::json_one(
            &self.pool,
            "SELECT payload FROM preparation_batches WHERE id=?",
            &query.id,
        )
        .await?;
        match query.action.as_str() {
            "cancel" => {
                batch.cancel_requested = true;
                if batch.state == "queued" {
                    batch.state = "cancelled".into();
                }
            }
            "resume" => {
                if ["running", "queued"].contains(&batch.state.as_str()) {
                    return Ok(batch);
                }
                batch.workspace_epoch = query.workspace_epoch;
                batch.session_epoch = self.connection.read().await.session_epoch.clone();
                batch.cancel_requested = false;
                batch.state = "queued".into();
                for member in &mut batch.members {
                    if !["completed", "existing", "not_applicable"]
                        .contains(&member.report.as_str())
                    {
                        member.error = None;
                        member.report = "pending".into();
                    }
                }
            }
            _ => return Err(AppError::new(ErrorCode::InvalidInput)),
        }
        batch.updated_at = storage::now();
        self.persist_preparation(&batch).await?;
        if query.action == "resume" {
            self.spawn_preparation(batch.clone());
        }
        Ok(batch)
    }
    async fn persist_preparation(&self, batch: &PreparationBatch) -> Result<()> {
        sqlx::query("INSERT INTO preparation_batches VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload=CASE WHEN json_extract(preparation_batches.payload,'$.cancelRequested')=1 AND excluded.state<>'queued' THEN json_set(excluded.payload,'$.cancelRequested',json('true')) ELSE excluded.payload END").bind(&batch.id).bind(&batch.player_key).bind(&batch.state).bind(serde_json::to_string(batch)?).execute(&self.pool).await?;
        self.emit("preparations-changed", Some(batch.id.clone()), 0)
            .await;
        Ok(())
    }
    fn spawn_preparation(self: &Arc<Self>, batch: PreparationBatch) {
        let service = self.clone();
        tokio::spawn(async move {
            let result = service.run_preparation(batch.clone()).await;
            if let Err(error) = result {
                let _workspace = service.maintenance.read().await;
                if service
                    .check_workspace(&batch.workspace_epoch)
                    .await
                    .is_ok()
                    && let Ok(mut current) = db::json_one::<PreparationBatch>(
                        &service.pool,
                        "SELECT payload FROM preparation_batches WHERE id=?",
                        &batch.id,
                    )
                    .await
                {
                    current.state = if error.code == ErrorCode::Cancelled {
                        "cancelled"
                    } else {
                        "interrupted"
                    }
                    .into();
                    current.updated_at = storage::now();
                    let _ = service.persist_preparation(&current).await;
                }
            }
        });
    }
    async fn preparation_checkpoint(&self, batch: &PreparationBatch) -> Result<()> {
        self.check_workspace(&batch.workspace_epoch).await?;
        let current: PreparationBatch = db::json_one(
            &self.pool,
            "SELECT payload FROM preparation_batches WHERE id=?",
            &batch.id,
        )
        .await?;
        if current.cancel_requested {
            return Err(AppError::new(ErrorCode::Cancelled));
        }
        Ok(())
    }
    async fn wait_preparation_task(&self, task: &Task, batch: &PreparationBatch) -> Result<()> {
        loop {
            self.check_workspace(&batch.workspace_epoch).await?;
            let current = storage::task(&self.pool, &task.id).await?;
            match current.state {
                JobState::Completed => return Ok(()),
                JobState::Failed | JobState::Cancelled | JobState::Interrupted => {
                    return Err(current.error.unwrap_or(AppError::new(ErrorCode::Cancelled)));
                }
                _ => tokio::time::sleep(std::time::Duration::from_millis(25)).await,
            }
        }
    }
    async fn run_preparation(self: &Arc<Self>, mut batch: PreparationBatch) -> Result<()> {
        for index in 0..batch.members.len() {
            self.preparation_checkpoint(&batch).await?;
            if ["existing", "completed", "not_applicable"]
                .contains(&batch.members[index].report.as_str())
            {
                continue;
            }
            let key = MatchRef {
                match_key: batch.members[index].match_key.clone(),
                player_key: batch.player_key.clone(),
            };
            let result: Result<()> = async {
                let input = db::input(&self.pool, &key, None).await?;
                if input
                    .as_ref()
                    .is_none_or(|input| input.timeline_snapshot.is_none())
                {
                    let connection = self.connection.read().await.clone();
                    if connection.session_epoch != batch.session_epoch
                        || connection
                            .player
                            .as_ref()
                            .is_none_or(|player| player.player_key != batch.player_key)
                    {
                        if input.is_none() {
                            return Err(AppError::new(ErrorCode::SessionChanged));
                        }
                    } else if connection.phase == ConnectionPhase::Connected {
                        let task = self
                            .start_details_in_workspace(
                                key.clone(),
                                Some(&batch.workspace_epoch),
                                Some(&batch.session_epoch),
                                Some(&batch.id),
                            )
                            .await?;
                        self.wait_preparation_task(&task, &batch).await?;
                        batch.members[index].details = "completed".into();
                    } else if input.is_none() {
                        return Err(AppError::new(ErrorCode::ClientNotFound));
                    }
                }
                self.preparation_checkpoint(&batch).await?;
                let input = db::input(&self.pool, &key, None)
                    .await?
                    .ok_or(AppError::new(ErrorCode::DataIncomplete))?;
                batch.members[index].input_revision = Some(input.revision);
                let task = self
                    .start_review_in_workspace(
                        GenerateReview {
                            match_key: key.match_key.clone(),
                            player_key: key.player_key.clone(),
                            input_revision: input.revision,
                        },
                        Some(&batch.workspace_epoch),
                        Some(&batch.id),
                    )
                    .await?;
                self.wait_preparation_task(&task, &batch).await?;
                let completed = storage::task(&self.pool, &task.id).await?;
                batch.members[index].report_id = completed.result.map(|result| result.reference);
                Ok(())
            }
            .await;
            let _workspace = self.maintenance.read().await;
            self.check_workspace(&batch.workspace_epoch).await?;
            let current: PreparationBatch = db::json_one(
                &self.pool,
                "SELECT payload FROM preparation_batches WHERE id=?",
                &batch.id,
            )
            .await?;
            batch.cancel_requested = current.cancel_requested;
            let stop = result.as_ref().err().is_some_and(|error| {
                [
                    ErrorCode::Forbidden,
                    ErrorCode::WaitingAuth,
                    ErrorCode::RateLimited,
                    ErrorCode::SessionChanged,
                ]
                .contains(&error.code)
            });
            match result {
                Ok(()) => batch.members[index].report = "completed".into(),
                Err(error) => {
                    batch.members[index].report = "failed".into();
                    batch.members[index].error = Some(error);
                }
            }
            batch.state = if stop { "interrupted" } else { "running" }.into();
            batch.updated_at = storage::now();
            self.persist_preparation(&batch).await?;
            if stop {
                return Ok(());
            }
        }
        let _workspace = self.maintenance.read().await;
        self.preparation_checkpoint(&batch).await?;
        batch.state = if batch.members.iter().any(|member| member.error.is_some()) {
            "partial"
        } else {
            "completed"
        }
        .into();
        batch.updated_at = storage::now();
        self.persist_preparation(&batch).await?;
        self.emit("review-changed", Some(batch.player_key), 0).await;
        Ok(())
    }
}
