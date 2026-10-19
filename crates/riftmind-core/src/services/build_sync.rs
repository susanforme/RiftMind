use super::*;
use sqlx::Row;

#[derive(Clone)]
pub(super) struct BuildSelection {
    pub champion_id: u32,
    pub map_id: u32,
    pub rule_revision: u32,
}

// Only an actual selection and an explicit map from the client can trigger a write.
pub fn selected_build_context(raw: &Value) -> Option<(u32, u32)> {
    if raw["phase"] != "ChampSelect" {
        return None;
    }
    let local_cell = raw.pointer("/champSelect/localPlayerCellId")?.as_i64()?;
    let champion = raw
        .pointer("/champSelect/myTeam")?
        .as_array()?
        .iter()
        .find(|seat| seat["cellId"].as_i64() == Some(local_cell))?["championId"]
        .as_u64()?
        .try_into()
        .ok()
        .filter(|id: &u32| *id > 0)?;
    let map_id = raw
        .pointer("/game/map/id")
        .or_else(|| raw.pointer("/game/gameData/queue/mapId"))?
        .as_u64()?
        .try_into()
        .ok()
        .filter(|id: &u32| [11, 12].contains(id))?;
    Some((champion, map_id))
}

impl Service {
    pub async fn build_sync_rules(&self, query: BuildSyncQuery) -> Result<Vec<BuildSyncRule>> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT payload FROM champion_build_rules WHERE (? IS NULL OR champion_id=?) ORDER BY champion_id,map_id",
        ).bind(query.champion_id).bind(query.champion_id).fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|payload| serde_json::from_str(&payload).map_err(AppError::from))
            .collect()
    }

    pub async fn save_build_sync_rule(&self, query: SaveBuildSyncRule) -> Result<BuildSyncRule> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        let _single = self.build_lock.lock().await;
        let entry = notebooks::entry(&self.pool, &query.entry_id).await?;
        if entry.deleted || entry.content.kind != NotebookKind::Build {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let map_id = entry
            .content
            .map_id
            .ok_or(AppError::new(ErrorCode::InvalidInput))?;
        if query.enabled {
            let (_, issues) = self
                .checked_build(&BuildExportQuery {
                    entry_id: entry.id.clone(),
                    target_version: entry.content.resource_version.clone().unwrap_or_default(),
                    map_id,
                })
                .await?;
            if !issues.is_empty() {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
        }
        let previous = sqlx::query(
            "SELECT entry_id,revision FROM champion_build_rules WHERE champion_id=? AND map_id=?",
        )
        .bind(entry.content.champion_id)
        .bind(map_id)
        .fetch_optional(&self.pool)
        .await?;
        if previous
            .as_ref()
            .map_or(0, |row| row.get::<u32, _>("revision"))
            != query.expected_revision
            || (!query.enabled
                && previous
                    .as_ref()
                    .is_some_and(|row| row.get::<String, _>("entry_id") != entry.id))
        {
            return Err(AppError::new(ErrorCode::RevisionConflict));
        }
        let rule = BuildSyncRule {
            champion_id: entry.content.champion_id,
            map_id,
            entry_id: entry.id.clone(),
            enabled: query.enabled,
            revision: query.expected_revision + 1,
            state: if query.enabled { "waiting" } else { "disabled" }.into(),
            error: None,
            application: None,
            updated_at: storage::now(),
        };
        let changed = sqlx::query("INSERT INTO champion_build_rules VALUES(?,?,?,?,?,?) ON CONFLICT(champion_id,map_id) DO UPDATE SET entry_id=excluded.entry_id,revision=excluded.revision,enabled=excluded.enabled,payload=excluded.payload WHERE champion_build_rules.revision=?")
            .bind(rule.champion_id).bind(rule.map_id).bind(&rule.entry_id).bind(rule.revision).bind(rule.enabled)
            .bind(serde_json::to_string(&rule)?).bind(query.expected_revision).execute(&self.pool).await?;
        if changed.rows_affected() != 1 {
            return Err(AppError::new(ErrorCode::RevisionConflict));
        }
        self.emit("notebooks-changed", Some(entry.id), rule.revision)
            .await;
        Ok(rule)
    }

    pub(super) async fn validate_build_selection(
        &self,
        selection: &BuildSelection,
        entry_id: &str,
        raw: &Value,
    ) -> Result<()> {
        if selected_build_context(raw) != Some((selection.champion_id, selection.map_id)) {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        let enabled: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM champion_build_rules WHERE champion_id=? AND map_id=? AND entry_id=? AND revision=? AND enabled=1)")
            .bind(selection.champion_id).bind(selection.map_id).bind(entry_id).bind(selection.rule_revision).fetch_one(&self.pool).await?;
        if !enabled {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        Ok(())
    }

    pub async fn sync_champion_build(&self, snapshot: &LiveSnapshot, raw: &Value) -> Result<()> {
        let Ok(mut attempt) = self.build_sync_lock.try_lock() else {
            return Ok(());
        };
        if snapshot.stale || snapshot.phase != "ChampSelect" {
            *attempt = None;
            return Ok(());
        }
        let Some((champion_id, map_id)) = selected_build_context(raw) else {
            return Ok(());
        };
        let epoch = self.state.read().await.workspace_epoch.clone();
        if self.connection.read().await.session_epoch != snapshot.session_epoch {
            return Ok(());
        }
        let payload: Option<String> = sqlx::query_scalar("SELECT payload FROM champion_build_rules WHERE champion_id=? AND map_id=? AND enabled=1")
            .bind(champion_id).bind(map_id).fetch_optional(&self.pool).await?;
        let Some(payload) = payload else {
            return Ok(());
        };
        let mut rule: BuildSyncRule = serde_json::from_str(&payload)?;
        let entry = notebooks::entry(&self.pool, &rule.entry_id).await?;
        if entry.deleted {
            return Ok(());
        }
        let signature = format!(
            "{epoch}:{}:{}:{}:{}:{}",
            snapshot.session_epoch,
            snapshot.generation,
            rule.entry_id,
            rule.revision,
            entry.revision
        );
        if attempt.as_ref() == Some(&signature) {
            return Ok(());
        }
        *attempt = Some(signature);
        let outcome = self
            .apply_build_guarded(
                BuildApplyQuery {
                    workspace_epoch: epoch.clone(),
                    entry_id: entry.id.clone(),
                    expected_revision: entry.revision,
                    target_version: entry.content.resource_version.clone().unwrap_or_default(),
                    map_id,
                    save_as_new: false,
                    overwrite_remote: false,
                },
                Some(BuildSelection {
                    champion_id,
                    map_id,
                    rule_revision: rule.revision,
                }),
            )
            .await;
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&epoch).await?;
        rule.updated_at = storage::now();
        match outcome {
            Ok(application) => {
                rule.state = application.state.clone();
                rule.application = Some(application);
                rule.error = None;
            }
            Err(error) => {
                rule.state = "failed".into();
                rule.error = Some(error.code);
                rule.application = None;
            }
        }
        let changed = sqlx::query("UPDATE champion_build_rules SET payload=? WHERE champion_id=? AND map_id=? AND entry_id=? AND revision=? AND enabled=1")
            .bind(serde_json::to_string(&rule)?).bind(champion_id).bind(map_id).bind(&entry.id).bind(rule.revision).execute(&self.pool).await?;
        if changed.rows_affected() == 1 {
            self.emit("notebooks-changed", Some(entry.id), rule.revision)
                .await;
        }
        Ok(())
    }
}
