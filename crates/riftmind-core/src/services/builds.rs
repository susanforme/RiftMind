use super::notebooks::entry;
use super::*;
use sqlx::Row;

pub fn client_item_set(entry: &NotebookEntry, uid: &str, map_id: u32) -> Value {
    json!({"uid":uid,"title":entry.content.title,"type":"custom","map":"any","mode":"any","associatedChampions":[entry.content.champion_id],"associatedMaps":[map_id],"blocks":entry.content.groups.iter().map(|group|json!({"type":group.name,"items":group.items.iter().map(|item|json!({"id":item.id.to_string(),"count":item.count})).collect::<Vec<_>>()})).collect::<Vec<_>>()})
}
fn collection_sets(collection: &Value) -> Result<&Vec<Value>> {
    let sets = collection
        .get("itemSets")
        .and_then(Value::as_array)
        .ok_or(AppError::new(ErrorCode::DataIncomplete))?;
    let mut ids = std::collections::BTreeSet::new();
    if sets.len() > 1000
        || sets.iter().any(|set| {
            set["uid"]
                .as_str()
                .is_none_or(|uid| uid.is_empty() || !ids.insert(uid))
        })
    {
        return Err(AppError::new(ErrorCode::DataIncomplete));
    }
    Ok(sets)
}
fn matches_build(remote: &Value, desired: &Value) -> bool {
    [
        "uid",
        "title",
        "associatedChampions",
        "associatedMaps",
        "blocks",
    ]
    .iter()
    .all(|key| remote[*key] == desired[*key])
}
impl Service {
    async fn checked_build(
        &self,
        query: &BuildExportQuery,
    ) -> Result<(NotebookEntry, Vec<String>)> {
        let entry = entry(&self.pool, &query.entry_id).await?;
        if entry.deleted || entry.content.kind != NotebookKind::Build {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        notebooks::validate_patch(&query.target_version)?;
        let catalogue = self
            .resources
            .read()
            .await
            .item_catalogue(
                &self.asset_root,
                ItemCatalogueQuery {
                    version: query.target_version.clone(),
                    locale: "en-US".into(),
                },
            )
            .await?;
        let mut issues = Vec::new();
        if entry.content.map_id != Some(query.map_id) {
            issues.push("map_mismatch".into());
        }
        for item in entry.content.groups.iter().flat_map(|group| &group.items) {
            match catalogue
                .items
                .iter()
                .find(|candidate| candidate.id == item.id)
            {
                None => issues.push(format!("missing_item:{}", item.id)),
                Some(candidate) if !candidate.purchasable => {
                    issues.push(format!("not_purchasable:{}", item.id))
                }
                Some(candidate) if !candidate.maps.contains(&query.map_id) => {
                    issues.push(format!("map_unavailable:{}", item.id))
                }
                _ => {}
            }
        }
        Ok((entry, issues))
    }
    pub async fn export_build(&self, query: BuildExportQuery) -> Result<BuildExport> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        let (entry, issues) = self.checked_build(&query).await?;
        Ok(BuildExport {
            json: if issues.is_empty() {
                serde_json::to_string_pretty(&client_item_set(&entry, &entry.id, query.map_id))?
            } else {
                String::new()
            },
            issues,
        })
    }
    pub async fn apply_build(&self, query: BuildApplyQuery) -> Result<BuildApplication> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        let _single = self.build_lock.lock().await;
        let (entry, issues) = self
            .checked_build(&BuildExportQuery {
                entry_id: query.entry_id.clone(),
                target_version: query.target_version.clone(),
                map_id: query.map_id,
            })
            .await?;
        if entry.revision != query.expected_revision {
            return Err(AppError::new(ErrorCode::RevisionConflict));
        }
        if !issues.is_empty() {
            let mut error = AppError::new(ErrorCode::InvalidInput);
            error.params.insert("items".into(), issues.join(","));
            return Err(error);
        }
        let connection = self.connection.read().await.clone();
        let player = connection
            .player
            .as_ref()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
        if connection.phase != ConnectionPhase::Connected {
            return Err(AppError::new(ErrorCode::ClientNotFound));
        }
        let remote = self
            .remote
            .read()
            .await
            .clone()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
        let mut result = BuildApplication {
            entry_id: entry.id.clone(),
            player_key: Some(player.player_key.clone()),
            remote_uid: None,
            state: "unavailable".into(),
            reason: None,
        };
        if !remote.item_sets_verified() {
            result.reason = Some("client_adapter_unverified".into());
            return Ok(result);
        }
        let live = remote.current_match().await?;
        if !["Lobby", "ChampSelect"].contains(&live["phase"].as_str().unwrap_or("")) {
            return Err(AppError::new(ErrorCode::Forbidden));
        }
        let identity = remote.item_set_identity().await?;
        let summoner_id = identity["summonerId"]
            .as_u64()
            .filter(|id| *id > 0)
            .ok_or(AppError::new(ErrorCode::DataIncomplete))?;
        if identity["puuid"].as_str() != Some(&player.puuid) {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        let mapping=sqlx::query("SELECT remote_uid,fingerprint,state,payload FROM build_applications WHERE entry_id=? AND player_key=?").bind(&entry.id).bind(&player.player_key).fetch_optional(&self.pool).await?;
        let uid = mapping
            .as_ref()
            .filter(|_| !query.save_as_new)
            .map(|mapping| mapping.get::<String, _>("remote_uid"))
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let desired = client_item_set(&entry, &uid, query.map_id);
        let mut collection = remote.item_sets(summoner_id).await?;
        let _ = collection_sets(&collection)?;
        if let Some(found) = collection_sets(&collection)?
            .iter()
            .find(|set| set["uid"] == uid)
        {
            if matches_build(found, &desired) {
                result.remote_uid = Some(uid);
                result.state = "applied".into();
                self.record_build(&result, found).await?;
                return Ok(result);
            }
            if let Some(mapping) = &mapping
                && !query.overwrite_remote
                && storage::hash(&serde_json::to_vec(found)?)
                    != mapping.get::<String, _>("fingerprint")
            {
                return Err(AppError::new(ErrorCode::RevisionConflict));
            }
        }
        // Whole-collection PUT has no conditional lock: another program can still write after this check.
        let latest = remote.item_sets(summoner_id).await?;
        if latest != collection {
            return Err(AppError::new(ErrorCode::RevisionConflict));
        }
        let current_identity = remote.item_set_identity().await?;
        let phase = remote.current_match().await?;
        let current = self.connection.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        if current.session_epoch != connection.session_epoch
            || current.phase != ConnectionPhase::Connected
            || current_identity != identity
            || !["Lobby", "ChampSelect"].contains(&phase["phase"].as_str().unwrap_or(""))
        {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        let sets = collection["itemSets"]
            .as_array_mut()
            .ok_or(AppError::new(ErrorCode::DataIncomplete))?;
        if let Some(index) = sets.iter().position(|set| set["uid"] == uid) {
            let mut merged = sets[index].clone();
            for (key, value) in desired.as_object().unwrap() {
                merged[key] = value.clone();
            }
            sets[index] = merged;
        } else {
            sets.push(desired.clone());
        }
        result.remote_uid = Some(uid.clone());
        result.state = "pending".into();
        self.record_build(&result, &desired).await?;
        let outcome = remote.put_item_sets(summoner_id, collection).await;
        let confirmed = remote.item_sets(summoner_id).await;
        if let Ok(confirmed) = confirmed {
            let sets = collection_sets(&confirmed)?;
            if let Some(found) = sets
                .iter()
                .find(|set| set["uid"] == uid && matches_build(set, &desired))
            {
                result.state = "applied".into();
                self.record_build(&result, found).await?;
                return Ok(result);
            }
        }
        result.reason = Some(
            if outcome.is_err() {
                "write_result_unknown"
            } else {
                "readback_mismatch"
            }
            .into(),
        );
        Ok(result)
    }
    async fn record_build(&self, result: &BuildApplication, remote: &Value) -> Result<()> {
        sqlx::query("INSERT INTO build_applications VALUES(?,?,?,?,?,?) ON CONFLICT(entry_id,player_key) DO UPDATE SET remote_uid=excluded.remote_uid,fingerprint=excluded.fingerprint,state=excluded.state,payload=excluded.payload").bind(&result.entry_id).bind(&result.player_key).bind(&result.remote_uid).bind(storage::hash(&serde_json::to_vec(remote)?)).bind(&result.state).bind(serde_json::to_string(result)?).execute(&self.pool).await?;
        Ok(())
    }
}
