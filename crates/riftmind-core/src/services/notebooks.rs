use super::*;
use sqlx::{Row, Sqlite, Transaction};
use std::collections::{BTreeMap, BTreeSet};

pub fn known_champion(id: u32) -> bool {
    let names: Value = serde_json::from_str(include_str!(
        "../../../../src/i18n/locales/en-US/labels.json"
    ))
    .expect("bundled champion names");
    names.get(format!("champion_{id}")).is_some()
}
fn invalid() -> AppError {
    AppError::new(ErrorCode::InvalidInput)
}
pub fn validate_content(content: &NotebookContent) -> Result<()> {
    if !known_champion(content.champion_id)
        || content.title.trim().is_empty()
        || content.title.len() > 300
        || content.text.len() > 100_000
        || content.tags.len() > 30
        || content.tags.iter().any(|tag| tag.len() > 100)
        || content.steps.len() > 100
        || content.groups.len() > 30
        || content.links.len() > 100
        || content.sources.len() > 100
        || content
            .skill_order
            .as_ref()
            .is_some_and(|order| order.len() > 18 || order.iter().any(|slot| *slot > 4))
        || content.opponent_id.is_some_and(|id| !known_champion(id))
        || content.position.as_ref().is_some_and(|position| {
            !["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].contains(&position.as_str())
        })
    {
        return Err(invalid());
    }
    for patch in [&content.confirmed_patch, &content.resource_version]
        .into_iter()
        .flatten()
    {
        validate_patch(patch)?;
    }
    if content.kind == NotebookKind::Matchup && content.opponent_id.is_none() {
        return Err(invalid());
    }
    if content.kind == NotebookKind::Build
        && (content.resource_version.is_none()
            || content.map_id.is_none()
            || (content.groups.is_empty()
                && !content
                    .skill_order
                    .as_ref()
                    .is_some_and(|order| order.iter().any(|slot| *slot > 0))))
    {
        return Err(invalid());
    }
    if content.kind != NotebookKind::Build
        && content.text.trim().is_empty()
        && content.steps.is_empty()
    {
        return Err(invalid());
    }
    for step in &content.steps {
        if step.label.len() > 500
            || (step.label.trim().is_empty() && step.entity_id.is_none())
            || match step.action {
                ComboAction::Skill => !step.entity_id.is_some_and(|slot| (1..=4).contains(&slot)),
                ComboAction::Item | ComboAction::Spell => {
                    !step.entity_id.is_some_and(|id| id > 0 && id < 1_000_000)
                }
                _ => false,
            }
        {
            return Err(invalid());
        }
    }
    for group in &content.groups {
        if group.name.trim().is_empty()
            || group.name.len() > 200
            || group.items.len() > 100
            || group.items.iter().any(|entry| {
                entry.id == 0 || entry.id >= 1_000_000 || !(1..=99).contains(&entry.count)
            })
        {
            return Err(invalid());
        }
    }
    for link in &content.links {
        domain::validate_key(&link.entry_id)?;
        if link.revision == 0 {
            return Err(invalid());
        }
    }
    Ok(())
}
pub fn validate_patch(patch: &str) -> Result<()> {
    if patch.len() > 24
        || !(2..=4).contains(&patch.split('.').count())
        || !patch
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(invalid());
    }
    Ok(())
}
pub async fn entry(pool: &SqlitePool, id: &str) -> Result<NotebookEntry> {
    domain::validate_key(id)?;
    storage::review::json_one(pool, "SELECT payload FROM notebook_entries WHERE id=?", id).await
}
async fn write_entry(
    tx: &mut Transaction<'_, Sqlite>,
    entry: &NotebookEntry,
    expected: u32,
) -> Result<()> {
    let payload = serde_json::to_string(entry)?;
    if expected == 0 {
        sqlx::query("INSERT INTO notebook_entries VALUES(?,?,?,?,?,?)")
            .bind(&entry.id)
            .bind(entry.content.champion_id)
            .bind(serde_json::to_value(&entry.content.kind)?.as_str().unwrap())
            .bind(entry.revision)
            .bind(entry.deleted)
            .bind(&payload)
            .execute(&mut **tx)
            .await?;
    } else if sqlx::query(
        "UPDATE notebook_entries SET revision=?,deleted=?,payload=? WHERE id=? AND revision=?",
    )
    .bind(entry.revision)
    .bind(entry.deleted)
    .bind(&payload)
    .bind(&entry.id)
    .bind(expected)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        != 1
    {
        return Err(AppError::new(ErrorCode::RevisionConflict));
    }
    sqlx::query("INSERT INTO notebook_revisions VALUES(?,?,?)")
        .bind(&entry.id)
        .bind(entry.revision)
        .bind(payload)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
impl Service {
    pub async fn notebook_entries(&self, query: NotebookQuery) -> Result<Vec<NotebookEntry>> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        if query.search.len() > 300 {
            return Err(invalid());
        }
        let rows:Vec<String>=sqlx::query_scalar("SELECT payload FROM notebook_entries WHERE (? IS NULL OR champion_id=?) AND deleted=? ORDER BY json_extract(payload,'$.content.pinned') DESC,json_extract(payload,'$.updatedAt') DESC,id").bind(query.champion_id).bind(query.champion_id).bind(query.trash).fetch_all(&self.pool).await?;
        let search = query.search.to_lowercase();
        rows.into_iter()
            .map(|payload| serde_json::from_str::<NotebookEntry>(&payload).map_err(AppError::from))
            .collect::<Result<Vec<_>>>()
            .map(|entries| {
                entries
                    .into_iter()
                    .filter(|entry| {
                        query
                            .kind
                            .as_ref()
                            .is_none_or(|kind| entry.content.kind == *kind)
                            && query
                                .opponent_id
                                .is_none_or(|id| entry.content.opponent_id == Some(id))
                            && (entry.content.title.to_lowercase().contains(&search)
                                || entry.content.text.to_lowercase().contains(&search)
                                || entry
                                    .content
                                    .tags
                                    .iter()
                                    .any(|tag| tag.to_lowercase().contains(&search)))
                    })
                    .collect()
            })
    }
    pub async fn save_notebook(&self, mut query: SaveNotebook) -> Result<NotebookEntry> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        validate_content(&query.content)?;
        let previous = match &query.id {
            Some(id) => Some(entry(&self.pool, id).await?),
            None => None,
        };
        if previous.as_ref().map_or(0, |entry| entry.revision) != query.expected_revision {
            return Err(AppError::new(ErrorCode::RevisionConflict));
        }
        if previous.as_ref().is_some_and(|entry| {
            entry.deleted
                || entry.content.champion_id != query.content.champion_id
                || entry.content.kind != query.content.kind
        }) {
            return Err(invalid());
        }
        for link in &mut query.content.links {
            match entry(&self.pool, &link.entry_id).await {
                Ok(current) if !current.deleted => link.revision = current.revision,
                _ if previous.as_ref().is_some_and(|previous| {
                    previous.content.links.iter().any(|existing| {
                        existing.entry_id == link.entry_id && existing.revision == link.revision
                    })
                }) => {}
                _ => return Err(AppError::new(ErrorCode::EvidenceUnavailable)),
            }
        }
        for source in &query.content.sources {
            if previous.as_ref().is_some_and(|entry| {
                entry.content.sources.iter().any(|existing| {
                    serde_json::to_value(existing).ok() == serde_json::to_value(source).ok()
                })
            }) {
                continue;
            }
            storage::review::summary(
                &self.pool,
                &MatchRef {
                    match_key: source.match_key.clone(),
                    player_key: source.player_key.clone(),
                },
            )
            .await?;
            if let Some(id) = &source.report_id {
                let report = storage::review::report(&self.pool, id).await?;
                if report.match_key != source.match_key
                    || report.player_key != source.player_key
                    || source.evidence_id.as_ref().is_some_and(|id| {
                        !report.evidence.iter().any(|reference| reference.id == *id)
                    })
                {
                    return Err(invalid());
                }
            } else if source.evidence_id.is_some() {
                return Err(invalid());
            }
        }
        let revision = query.expected_revision + 1;
        let explicitly_confirmed = query.confirm_patch.is_some();
        if let Some(patch) = query.confirm_patch {
            validate_patch(&patch)?;
            query.content.confirmed_patch = Some(patch);
        }
        let reviewed_revision = if explicitly_confirmed {
            Some(revision)
        } else {
            None
        };
        let saved = NotebookEntry {
            id: query.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            revision,
            content: query.content,
            reviewed_revision,
            deleted: false,
            updated_at: storage::now(),
        };
        let mut tx = self.pool.begin().await?;
        write_entry(&mut tx, &saved, query.expected_revision).await?;
        if previous
            .as_ref()
            .is_some_and(|previous| previous.content.map_id != saved.content.map_id)
        {
            sqlx::query("UPDATE champion_build_rules SET enabled=0,revision=revision+1,payload=json_set(payload,'$.enabled',json('false'),'$.revision',revision+1,'$.state','disabled') WHERE entry_id=?")
                .bind(&saved.id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        self.emit("notebooks-changed", Some(saved.id.clone()), saved.revision)
            .await;
        Ok(saved)
    }
    pub async fn notebook_history(&self, id: &str) -> Result<NotebookHistory> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        let _ = entry(&self.pool, id).await?;
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT payload FROM notebook_revisions WHERE entry_id=? ORDER BY revision DESC",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        Ok(NotebookHistory {
            entry_id: id.into(),
            revisions: rows
                .into_iter()
                .map(|payload| serde_json::from_str(&payload).map_err(AppError::from))
                .collect::<Result<_>>()?,
        })
    }
    pub async fn change_notebook(&self, query: ChangeNotebook) -> Result<Empty> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        let mut current = entry(&self.pool, &query.id).await?;
        if current.revision != query.expected_revision {
            return Err(AppError::new(ErrorCode::RevisionConflict));
        }
        match query.action.as_str() {
            "trash" => current.deleted = true,
            "recover" => current.deleted = false,
            "restore" => {
                let revision = query.restore_revision.ok_or_else(invalid)?;
                let payload: String = sqlx::query_scalar(
                    "SELECT payload FROM notebook_revisions WHERE entry_id=? AND revision=?",
                )
                .bind(&query.id)
                .bind(revision)
                .fetch_optional(&self.pool)
                .await?
                .ok_or(AppError::new(ErrorCode::NotFound))?;
                let historical: NotebookEntry = serde_json::from_str(&payload)?;
                current.content = historical.content;
                current.reviewed_revision = historical
                    .reviewed_revision
                    .filter(|revision| *revision == historical.revision)
                    .map(|_| query.expected_revision + 1);
                current.deleted = false;
            }
            "confirm" => {
                let patch = query.restore_revision.map(|_| ()).is_none();
                if !patch || current.content.confirmed_patch.is_none() {
                    return Err(invalid());
                }
                current.reviewed_revision = Some(query.expected_revision + 1);
            }
            "purge" if current.deleted && query.confirm_permanent => {}
            _ => return Err(invalid()),
        }
        let mut tx = self.pool.begin().await?;
        if query.action == "purge" {
            if sqlx::query("DELETE FROM notebook_entries WHERE id=? AND revision=?")
                .bind(&query.id)
                .bind(query.expected_revision)
                .execute(&mut *tx)
                .await?
                .rows_affected()
                != 1
            {
                return Err(AppError::new(ErrorCode::RevisionConflict));
            }
        } else {
            if ["trash", "recover"].contains(&query.action.as_str())
                && current.reviewed_revision == Some(current.revision)
            {
                current.reviewed_revision = Some(current.revision + 1);
            }
            current.revision += 1;
            current.updated_at = storage::now();
            write_entry(&mut tx, &current, query.expected_revision).await?;
        }
        if query.action == "trash" {
            sqlx::query("UPDATE champion_build_rules SET enabled=0,revision=revision+1,payload=json_set(payload,'$.enabled',json('false'),'$.revision',revision+1,'$.state','disabled') WHERE entry_id=?")
                .bind(&query.id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        self.emit("notebooks-changed", Some(query.id), current.revision)
            .await;
        Ok(Empty {})
    }
    pub async fn practice_entries(&self, query: NotebookQuery) -> Result<Vec<PracticeEntry>> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT payload FROM practice_entries WHERE (? IS NULL OR champion_id=?) ORDER BY id",
        )
        .bind(query.champion_id)
        .bind(query.champion_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|payload| serde_json::from_str(&payload).map_err(AppError::from))
            .collect()
    }
    pub async fn save_practice(&self, mut query: SavePractice) -> Result<Empty> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        let practice = &mut query.entry;
        if !known_champion(practice.champion_id)
            || practice.title.trim().is_empty()
            || practice.title.len() > 300
            || practice.notes.len() > 100_000
        {
            return Err(invalid());
        }
        let prior: Option<String> =
            sqlx::query_scalar("SELECT payload FROM practice_entries WHERE id=?")
                .bind(&practice.id)
                .fetch_optional(&self.pool)
                .await?;
        let prior: Option<PracticeEntry> = prior
            .map(|payload| serde_json::from_str(&payload))
            .transpose()?;
        if let Some(source_id) = &practice.source_id
            && prior
                .as_ref()
                .is_none_or(|previous| previous.source_id.as_ref() != Some(source_id))
        {
            let source = entry(&self.pool, source_id).await?;
            if source.content.champion_id != practice.champion_id {
                return Err(invalid());
            }
            if practice.source_revision.is_none() {
                practice.source_revision = Some(source.revision);
            }
        }
        practice.revision = query.expected_revision + 1;
        practice.updated_at = storage::now();
        let mut tx = self.pool.begin().await?;
        let revision: Option<u32> =
            sqlx::query_scalar("SELECT revision FROM practice_entries WHERE id=?")
                .bind(&practice.id)
                .fetch_optional(&mut *tx)
                .await?;
        if revision.unwrap_or(0) != query.expected_revision {
            return Err(AppError::new(ErrorCode::RevisionConflict));
        }
        if query.delete {
            sqlx::query("DELETE FROM practice_entries WHERE id=?")
                .bind(&practice.id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("INSERT INTO practice_entries VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload").bind(&practice.id).bind(practice.champion_id).bind(practice.revision).bind(serde_json::to_string(practice)?).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        self.emit("notebooks-changed", None, 0).await;
        Ok(Empty {})
    }
    pub async fn export_notebook(&self, query: NotebookQuery) -> Result<NotebookExport> {
        let champion = query.champion_id.ok_or_else(invalid)?;
        if !known_champion(champion) {
            return Err(invalid());
        }
        let mut entries = self
            .notebook_entries(NotebookQuery {
                champion_id: Some(champion),
                kind: None,
                search: String::new(),
                opponent_id: None,
                trash: false,
            })
            .await?;
        let ids: BTreeSet<_> = entries.iter().map(|entry| entry.id.clone()).collect();
        for entry in &mut entries {
            entry.content.sources.clear();
            entry
                .content
                .links
                .retain(|link| ids.contains(&link.entry_id));
        }
        Ok(NotebookExport {
            format: "riftmind-champion-notebook".into(),
            version: 1,
            champion_id: champion,
            entries,
        })
    }
    pub async fn import_notebook(&self, query: NotebookTransfer) -> Result<ImportPreview> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        if query.json.len() > 4 * 1024 * 1024 {
            return Err(invalid());
        }
        let bundle: NotebookExport = serde_json::from_str(&query.json)?;
        if bundle.format != "riftmind-champion-notebook"
            || bundle.version != 1
            || !known_champion(bundle.champion_id)
            || bundle.entries.len() > 500
        {
            return Err(invalid());
        }
        let mut ids = BTreeSet::new();
        for entry in &bundle.entries {
            validate_content(&entry.content)?;
            domain::validate_key(&entry.id)?;
            if entry.content.champion_id != bundle.champion_id
                || entry.deleted
                || !ids.insert(entry.id.clone())
                || !entry.content.sources.is_empty()
            {
                return Err(invalid());
            }
        }
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT payload FROM notebook_entries WHERE champion_id=? AND deleted=0",
        )
        .bind(bundle.champion_id)
        .fetch_all(&self.pool)
        .await?;
        let existing: Vec<NotebookEntry> = rows
            .into_iter()
            .map(|payload| serde_json::from_str(&payload).map_err(AppError::from))
            .collect::<Result<_>>()?;
        let mut preview = ImportPreview {
            champion_id: bundle.champion_id,
            added: 0,
            duplicates: 0,
            conflicts: 0,
            missing_links: 0,
            entries: bundle.entries.clone(),
        };
        let imported_entries = bundle.entries.clone();
        let mut mapping = BTreeMap::new();
        let mut pending = Vec::new();
        for mut imported in bundle.entries {
            let duplicate = existing.iter().find(|entry| {
                equivalent(&entry.content, &imported.content)
                    && linked_content_signatures(entry, &existing)
                        == linked_content_signatures(&imported, &imported_entries)
            });
            if let Some(duplicate) = duplicate
                && !query.replacements.contains_key(&imported.id)
            {
                preview.duplicates += 1;
                mapping.insert(
                    imported.id,
                    NotebookLink {
                        entry_id: duplicate.id.clone(),
                        revision: duplicate.revision,
                    },
                );
                continue;
            }
            if existing.iter().any(|entry| {
                entry.content.title == imported.content.title
                    && entry.content.kind == imported.content.kind
            }) {
                preview.conflicts += 1;
            }
            let source_id = imported.id.clone();
            let expected = if let Some(replacement) = query.replacements.get(&imported.id) {
                let destination = existing
                    .iter()
                    .find(|entry| {
                        entry.id == replacement.entry_id
                            && entry.content.kind == imported.content.kind
                    })
                    .ok_or_else(invalid)?;
                if destination.revision != replacement.revision {
                    return Err(AppError::new(ErrorCode::RevisionConflict));
                }
                imported.id = destination.id.clone();
                destination.revision
            } else {
                0
            };
            if expected == 0 {
                imported.id = uuid::Uuid::new_v4().to_string();
            }
            imported.revision = expected + 1;
            imported.updated_at = storage::now();
            imported.reviewed_revision = None;
            mapping.insert(
                source_id,
                NotebookLink {
                    entry_id: imported.id.clone(),
                    revision: imported.revision,
                },
            );
            pending.push((imported, expected));
            preview.added += 1;
        }
        for (entry, _) in &mut pending {
            let links = std::mem::take(&mut entry.content.links);
            for link in links {
                if let Some(target) = mapping.get(&link.entry_id) {
                    entry.content.links.push(target.clone());
                } else {
                    preview.missing_links += 1;
                }
            }
        }
        if query.commit {
            let mut tx = self.pool.begin().await?;
            for (entry, expected) in &pending {
                write_entry(&mut tx, entry, *expected).await?;
            }
            tx.commit().await?;
            self.emit("notebooks-changed", None, 0).await;
        }
        Ok(preview)
    }
}
fn linked_content_signatures(entry: &NotebookEntry, entries: &[NotebookEntry]) -> Vec<String> {
    let mut signatures: Vec<_> = entry
        .content
        .links
        .iter()
        .map(|link| {
            if let Some(target) = entries
                .iter()
                .find(|candidate| candidate.id == link.entry_id)
            {
                let mut content = target.content.clone();
                content.links.clear();
                content.sources.clear();
                storage::hash(&serde_json::to_vec(&content).expect("serializable notebook content"))
            } else {
                format!("unavailable:{}", link.entry_id)
            }
        })
        .collect();
    signatures.sort();
    signatures
}
fn equivalent(left: &NotebookContent, right: &NotebookContent) -> bool {
    let mut left = left.clone();
    let mut right = right.clone();
    for content in [&mut left, &mut right] {
        content.links.clear();
        content.sources.clear();
    }
    serde_json::to_value(left).ok() == serde_json::to_value(right).ok()
}
pub async fn validate_saved_notebooks(pool: &SqlitePool) -> Result<()> {
    let rows = sqlx::query("SELECT id,champion_id,revision,payload FROM notebook_entries")
        .fetch_all(pool)
        .await?;
    for row in rows {
        let entry: NotebookEntry = serde_json::from_str(row.get("payload"))?;
        validate_content(&entry.content)?;
        if entry.id != row.get::<String, _>("id")
            || entry.content.champion_id != row.get::<u32, _>("champion_id")
            || entry.revision != row.get::<u32, _>("revision")
        {
            return Err(invalid());
        }
        let revision: Option<String> = sqlx::query_scalar(
            "SELECT payload FROM notebook_revisions WHERE entry_id=? AND revision=?",
        )
        .bind(&entry.id)
        .bind(entry.revision)
        .fetch_optional(pool)
        .await?;
        if revision.as_deref() != Some(row.get::<&str, _>("payload")) {
            return Err(invalid());
        }
    }
    let rows = sqlx::query("SELECT entry_id,revision,payload FROM notebook_revisions")
        .fetch_all(pool)
        .await?;
    for row in rows {
        let revision: NotebookEntry = serde_json::from_str(row.get("payload"))?;
        validate_content(&revision.content)?;
        if revision.id != row.get::<String, _>("entry_id")
            || revision.revision != row.get::<u32, _>("revision")
        {
            return Err(invalid());
        }
    }
    let rows = sqlx::query("SELECT id,champion_id,revision,payload FROM practice_entries")
        .fetch_all(pool)
        .await?;
    for row in rows {
        let practice: PracticeEntry = serde_json::from_str(row.get("payload"))?;
        if practice.id != row.get::<String, _>("id")
            || practice.champion_id != row.get::<u32, _>("champion_id")
            || practice.revision != row.get::<u32, _>("revision")
            || !known_champion(practice.champion_id)
            || practice.title.len() > 300
            || practice.notes.len() > 100000
        {
            return Err(invalid());
        }
    }
    Ok(())
}
