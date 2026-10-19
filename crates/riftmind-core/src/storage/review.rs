use crate::{
    contracts::*,
    domain::{self, analysis},
    storage,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
pub fn conflict<T: serde::Serialize>(current: &T) -> AppError {
    let mut e = AppError::new(ErrorCode::RevisionConflict);
    e.params.insert(
        "current".into(),
        serde_json::to_string(current).unwrap_or_default(),
    );
    e
}
pub async fn summary(pool: &SqlitePool, key: &MatchRef) -> Result<MatchSummary> {
    domain::validate_key(&key.match_key)?;
    domain::validate_key(&key.player_key)?;
    let payload: String = sqlx::query_scalar(
        "SELECT projection FROM match_participants WHERE match_key=? AND player_key=?",
    )
    .bind(&key.match_key)
    .bind(&key.player_key)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(serde_json::from_str(&payload)?)
}
pub async fn input(
    pool: &SqlitePool,
    key: &MatchRef,
    revision: Option<u32>,
) -> Result<Option<AnalysisInput>> {
    domain::validate_key(&key.match_key)?;
    domain::validate_key(&key.player_key)?;
    let data:Option<String>=sqlx::query_scalar("SELECT payload FROM analysis_inputs WHERE match_key=? AND player_key=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1").bind(&key.match_key).bind(&key.player_key).bind(revision).bind(revision).fetch_optional(pool).await?;
    data.map(|s| serde_json::from_str(&s).map_err(Into::into))
        .transpose()
}
pub async fn required_input(
    pool: &SqlitePool,
    key: &MatchRef,
    revision: u32,
) -> Result<AnalysisInput> {
    input(pool, key, Some(revision))
        .await?
        .ok_or(AppError::new(ErrorCode::DataIncomplete))
}
pub async fn report(pool: &SqlitePool, id: &str) -> Result<ReviewReport> {
    domain::validate_key(id)?;
    let s: String = sqlx::query_scalar("SELECT payload FROM reviews WHERE id=?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(serde_json::from_str(&s)?)
}
pub async fn latest_report(pool: &SqlitePool, key: &MatchRef) -> Result<Option<ReviewReport>> {
    let s:Option<String>=sqlx::query_scalar("SELECT r.payload FROM reviews r JOIN analysis_inputs i ON i.id=r.input_id WHERE r.match_key=? AND r.player_key=? ORDER BY i.revision DESC,r.revision DESC LIMIT 1").bind(&key.match_key).bind(&key.player_key).fetch_optional(pool).await?;
    s.map(|s| serde_json::from_str(&s).map_err(Into::into))
        .transpose()
}
pub async fn snapshot(pool: &SqlitePool, id: &str) -> Result<Value> {
    let s:String=sqlx::query_scalar("SELECT s.payload FROM source_snapshots s JOIN snapshot_refs r ON r.hash=s.hash WHERE r.id=?").bind(id).fetch_optional(pool).await?.ok_or(AppError::new(ErrorCode::EvidenceUnavailable))?;
    Ok(serde_json::from_str(&s)?)
}
async fn snapshot_tx(
    tx: &mut Transaction<'_, Sqlite>,
    m: &MatchSummary,
    endpoint: &str,
    raw: &Value,
    source: &Source,
) -> Result<String> {
    let payload = serde_json::to_string(raw)?;
    let hash = storage::hash(payload.as_bytes());
    let source = if *source == Source::Sgp { "sgp" } else { "lcu" };
    sqlx::query("INSERT OR IGNORE INTO source_snapshots VALUES(?,?,?,?)")
        .bind(&hash)
        .bind(source)
        .bind(payload)
        .bind(storage::now())
        .execute(&mut **tx)
        .await?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO snapshot_refs VALUES(?,?,?,?,?,?)")
        .bind(&id)
        .bind(&m.match_key)
        .bind(endpoint)
        .bind(source)
        .bind(storage::now())
        .bind(hash)
        .execute(&mut **tx)
        .await?;
    Ok(id)
}
pub async fn save_input_tx(
    tx: &mut Transaction<'_, Sqlite>,
    mut input: AnalysisInput,
    m: &MatchSummary,
    summary: &Value,
    timeline: Option<&Value>,
    timeline_source: &Source,
) -> Result<AnalysisInput> {
    input.fingerprint = storage::hash(
        serde_json::to_vec(&(
            &input.converter_version,
            &input.context,
            &input.capabilities,
            &input.frames,
            &input.events,
            &input.limitations,
            summary,
            timeline,
        ))?
        .as_slice(),
    );
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT payload FROM analysis_inputs WHERE match_key=? AND player_key=? AND fingerprint=?",
    )
    .bind(&m.match_key)
    .bind(&m.player_key)
    .bind(&input.fingerprint)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(s) = existing {
        return Ok(serde_json::from_str(&s)?);
    }
    input.id = uuid::Uuid::new_v4().to_string();
    input.revision=sqlx::query_scalar::<_,i64>("SELECT COALESCE(MAX(revision),0)+1 FROM analysis_inputs WHERE match_key=? AND player_key=?").bind(&m.match_key).bind(&m.player_key).fetch_one(&mut **tx).await? as u32;
    input.summary_snapshot = snapshot_tx(tx, m, "SUMMARY", summary, &m.source).await?;
    input.timeline_snapshot = if let Some(t) = timeline {
        Some(snapshot_tx(tx, m, "DETAILS", t, timeline_source).await?)
    } else {
        None
    };
    sqlx::query("INSERT INTO analysis_inputs VALUES(?,?,?,?,?,?,?,?)")
        .bind(&input.id)
        .bind(&m.match_key)
        .bind(&m.player_key)
        .bind(input.revision)
        .bind(&input.fingerprint)
        .bind(&input.summary_snapshot)
        .bind(&input.timeline_snapshot)
        .bind(serde_json::to_string(&input)?)
        .execute(&mut **tx)
        .await?;
    Ok(input)
}
pub async fn cached_summary(pool: &SqlitePool, m: &MatchSummary) -> Result<Option<Value>> {
    let s:Option<String>=sqlx::query_scalar("SELECT s.payload FROM source_snapshots s JOIN match_revisions r ON r.hash=s.hash WHERE r.match_key=? AND r.player_key=? ORDER BY r.revision DESC LIMIT 1").bind(&m.match_key).bind(&m.player_key).fetch_optional(pool).await?;
    let Some(s) = s else { return Ok(None) };
    let v: Value = serde_json::from_str(&s)?;
    let list = v
        .get("games")
        .and_then(|v| {
            v.as_array()
                .or_else(|| v.get("games").and_then(Value::as_array))
        })
        .or_else(|| v.as_array());
    Ok(list
        .and_then(|gs| {
            gs.iter().find(|g| {
                let g = g.get("json").unwrap_or(g);
                let g = g.get("info").unwrap_or(g);
                g["gameId"]
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| g["gameId"].as_u64().map(|n| n.to_string()))
                    .as_deref()
                    == Some(&m.game_id)
            })
        })
        .cloned())
}
pub async fn evidence(pool: &SqlitePool, q: EvidenceQuery) -> Result<EvidenceData> {
    let r = report(pool, &q.report_id).await?;
    let key = MatchRef {
        match_key: r.match_key.clone(),
        player_key: r.player_key.clone(),
    };
    let input = required_input(pool, &key, r.input_revision).await?;
    analysis::validate_evidence(&input, &r)?;
    let reference = if let Some(e) = r.evidence.iter().find(|e| e.id == q.evidence_id) {
        e.clone()
    } else if let Some(e) = input.events.iter().find(|e| e.id == q.evidence_id) {
        analysis::event_evidence(&input, e)?
    } else {
        return Err(AppError::new(ErrorCode::EvidenceUnavailable));
    };
    let raw = snapshot(pool, &reference.snapshot_id)
        .await?
        .pointer(&reference.path)
        .cloned()
        .ok_or(AppError::new(ErrorCode::EvidenceUnavailable))?;
    if serde_json::to_vec(&raw)?.len() > 256 * 1024 {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    Ok(EvidenceData { reference, raw })
}
pub async fn annotations(pool: &SqlitePool, q: AnnotationsQuery) -> Result<ReviewAnnotations> {
    summary(
        pool,
        &MatchRef {
            match_key: q.match_key.clone(),
            player_key: q.player_key.clone(),
        },
    )
    .await?;
    if let Some(id) = &q.report_id {
        let r = report(pool, id).await?;
        if r.match_key != q.match_key || r.player_key != q.player_key {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
    }
    let rows=sqlx::query("SELECT * FROM review_notes WHERE match_key=? AND player_key=? AND (report_id IS NULL OR report_id=?) ORDER BY updated_at DESC,id LIMIT 200").bind(&q.match_key).bind(&q.player_key).bind(&q.report_id).fetch_all(pool).await?;
    let notes = rows.iter().map(note_row).collect();
    let rows = sqlx::query("SELECT * FROM review_feedback WHERE report_id=? ORDER BY finding_id")
        .bind(&q.report_id)
        .fetch_all(pool)
        .await?;
    Ok(ReviewAnnotations {
        notes,
        feedback: rows
            .iter()
            .map(|r| ReviewFeedback {
                report_id: r.get("report_id"),
                finding_id: r.get("finding_id"),
                value: r.get("value"),
                revision: r.get::<i64, _>("revision") as u32,
                updated_at: r.get("updated_at"),
            })
            .collect(),
    })
}
fn note_row(r: &sqlx::sqlite::SqliteRow) -> ReviewNote {
    ReviewNote {
        id: r.get("id"),
        match_key: r.get("match_key"),
        player_key: r.get("player_key"),
        report_id: r.get("report_id"),
        evidence_id: r.get("evidence_id"),
        text: r.get("text"),
        revision: r.get::<i64, _>("revision") as u32,
        updated_at: r.get("updated_at"),
    }
}
pub async fn save_note(pool: &SqlitePool, q: SaveNote) -> Result<ReviewNote> {
    summary(
        pool,
        &MatchRef {
            match_key: q.match_key.clone(),
            player_key: q.player_key.clone(),
        },
    )
    .await?;
    if q.text.chars().count() > 10000
        || q.text.trim().is_empty()
        || (q.evidence_id.is_some() && q.report_id.is_none())
    {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    if let Some(id) = &q.report_id {
        let r = report(pool, id).await?;
        if r.match_key != q.match_key || r.player_key != q.player_key {
            return Err(AppError::new(ErrorCode::EvidenceUnavailable));
        }
        if let Some(evidence_id) = &q.evidence_id {
            evidence(
                pool,
                EvidenceQuery {
                    report_id: id.clone(),
                    evidence_id: evidence_id.clone(),
                },
            )
            .await?;
        }
    }
    let id =
        q.id.clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    domain::validate_key(&id)?;
    let mut tx = pool.begin().await?;
    let old = sqlx::query("SELECT * FROM review_notes WHERE id=?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .map(|r| note_row(&r));
    if old.as_ref().map(|n| n.revision).unwrap_or(0) != q.expected_revision
        || old.as_ref().is_some_and(|n| {
            n.match_key != q.match_key
                || n.player_key != q.player_key
                || n.report_id != q.report_id
                || n.evidence_id != q.evidence_id
        })
    {
        return Err(conflict(&old));
    }
    if old.is_none() && q.id.is_some() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let n = ReviewNote {
        id,
        match_key: q.match_key,
        player_key: q.player_key,
        report_id: q.report_id,
        evidence_id: q.evidence_id,
        text: q.text,
        revision: q.expected_revision + 1,
        updated_at: storage::now(),
    };
    sqlx::query("INSERT INTO review_notes VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,revision=excluded.revision,updated_at=excluded.updated_at").bind(&n.id).bind(&n.match_key).bind(&n.player_key).bind(&n.report_id).bind(&n.evidence_id).bind(&n.text).bind(n.revision).bind(&n.updated_at).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(n)
}
pub async fn delete_note(pool: &SqlitePool, q: DeleteNote) -> Result<Empty> {
    domain::validate_key(&q.id)?;
    let mut tx = pool.begin().await?;
    let r = sqlx::query("SELECT * FROM review_notes WHERE id=?")
        .bind(&q.id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    let n = note_row(&r);
    if n.revision != q.expected_revision {
        return Err(conflict(&n));
    }
    sqlx::query("DELETE FROM review_notes WHERE id=? AND revision=?")
        .bind(&q.id)
        .bind(q.expected_revision)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Empty {})
}
pub async fn feedback(pool: &SqlitePool, q: SaveFeedback) -> Result<ReviewFeedback> {
    let r = report(pool, &q.report_id).await?;
    if !r.findings.iter().any(|f| f.id == q.finding_id)
        || q.value
            .as_deref()
            .is_some_and(|v| !["helpful", "inaccurate"].contains(&v))
    {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    let mut tx = pool.begin().await?;
    let old = sqlx::query("SELECT * FROM review_feedback WHERE report_id=? AND finding_id=?")
        .bind(&q.report_id)
        .bind(&q.finding_id)
        .fetch_optional(&mut *tx)
        .await?;
    let revision = old
        .as_ref()
        .map(|r| r.get::<i64, _>("revision") as u32)
        .unwrap_or(0);
    if revision != q.expected_revision {
        let mut e = AppError::new(ErrorCode::RevisionConflict);
        e.params
            .insert("currentRevision".into(), revision.to_string());
        e.params.insert(
            "currentValue".into(),
            old.as_ref()
                .and_then(|r| r.get::<Option<String>, _>("value"))
                .unwrap_or_default(),
        );
        return Err(e);
    }
    let n = ReviewFeedback {
        report_id: q.report_id,
        finding_id: q.finding_id,
        value: q.value,
        revision: revision + 1,
        updated_at: storage::now(),
    };
    sqlx::query("INSERT INTO review_feedback VALUES(?,?,?,?,?) ON CONFLICT(report_id,finding_id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at").bind(&n.report_id).bind(&n.finding_id).bind(&n.value).bind(n.revision).bind(&n.updated_at).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(n)
}
pub async fn json_one<T: DeserializeOwned>(pool: &SqlitePool, sql: &str, id: &str) -> Result<T> {
    domain::validate_key(id)?;
    let s: String = sqlx::query_scalar(sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(serde_json::from_str(&s)?)
}

pub fn match_from_page(v: &Value, id: &str) -> Option<Value> {
    let list = v
        .get("games")
        .and_then(|v| {
            v.as_array()
                .or_else(|| v.get("games").and_then(Value::as_array))
        })
        .or_else(|| v.as_array())?;
    list.iter()
        .find(|g| {
            let g = g.get("json").unwrap_or(g);
            let g = g.get("info").unwrap_or(g);
            g["gameId"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| g["gameId"].as_u64().map(|n| n.to_string()))
                .as_deref()
                == Some(id)
        })
        .cloned()
}

pub async fn refresh_settlement_tx(
    tx: &mut Transaction<'_, Sqlite>,
    mut m: MatchSummary,
    input: &AnalysisInput,
) -> Result<MatchSummary> {
    let old: String = sqlx::query_scalar(
        "SELECT projection FROM match_participants WHERE match_key=? AND player_key=?",
    )
    .bind(&m.match_key)
    .bind(&m.player_key)
    .fetch_one(&mut **tx)
    .await?;
    let previous: MatchSummary = serde_json::from_str(&old)?;
    m.revision = previous.revision;
    m.review_state = None;
    let mut compared = previous;
    compared.review_state = None;
    if serde_json::to_value(&m)? == serde_json::to_value(compared)? {
        return Ok(m);
    }
    m.revision += 1;
    sqlx::query("UPDATE matches SET queue_id=?,version=? WHERE match_key=?")
        .bind(m.queue_id)
        .bind(&m.version)
        .bind(&m.match_key)
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE match_participants SET champion_id=?,outcome=?,kills=?,deaths=?,assists=?,duration=?,position=?,cs=?,items=?,source=?,fallback_reason=?,revision=?,projection=? WHERE match_key=? AND player_key=?").bind(m.champion_id).bind(format!("{:?}",m.outcome)).bind(m.kills).bind(m.deaths).bind(m.assists).bind(m.duration).bind(&m.position).bind(m.cs).bind(serde_json::to_string(&m.items)?).bind(if m.source==Source::Sgp{"sgp"}else{"lcu"}).bind(&m.fallback_reason).bind(m.revision).bind(serde_json::to_string(&m)?).bind(&m.match_key).bind(&m.player_key).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO match_revisions SELECT ?,?,?,hash FROM snapshot_refs WHERE id=?")
        .bind(&m.match_key)
        .bind(&m.player_key)
        .bind(m.revision)
        .bind(&input.summary_snapshot)
        .execute(&mut **tx)
        .await?;
    Ok(m)
}

// A bundle's SQL foreign keys cannot validate IDs embedded in report/goal JSON.
pub async fn validate_business_evidence(pool: &SqlitePool) -> Result<()> {
    let refs: Vec<(String, String)> = sqlx::query_as(
        "SELECT s.hash,s.payload FROM source_snapshots s JOIN snapshot_refs r ON r.hash=s.hash",
    )
    .fetch_all(pool)
    .await?;
    for (hash, payload) in refs {
        if storage::hash(payload.as_bytes()) != hash {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
    }
    let rows = sqlx::query("SELECT * FROM analysis_inputs")
        .fetch_all(pool)
        .await?;
    for row in rows {
        let i: AnalysisInput = serde_json::from_str(row.get("payload"))?;
        let summary = snapshot(pool, &i.summary_snapshot).await?;
        let timeline = if let Some(id) = &i.timeline_snapshot {
            Some(snapshot(pool, id).await?)
        } else {
            None
        };
        let fingerprint = storage::hash(&serde_json::to_vec(&(
            &i.converter_version,
            &i.context,
            &i.capabilities,
            &i.frames,
            &i.events,
            &i.limitations,
            &summary,
            timeline.as_ref(),
        ))?);
        if i.id != row.get::<String, _>("id")
            || i.context.match_key != row.get::<String, _>("match_key")
            || i.context.player_key != row.get::<String, _>("player_key")
            || i.fingerprint != fingerprint
            || i.fingerprint != row.get::<String, _>("fingerprint")
            || i.summary_snapshot != row.get::<String, _>("summary_ref")
            || i.timeline_snapshot != row.get::<Option<String>, _>("timeline_ref")
            || i.context
                .participants
                .iter()
                .filter(|p| p.id == i.context.target_id)
                .count()
                != 1
        {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
    }
    let rows = sqlx::query(
        "SELECT r.*,i.payload input FROM reviews r JOIN analysis_inputs i ON i.id=r.input_id",
    )
    .fetch_all(pool)
    .await?;
    for row in rows {
        let r: ReviewReport = serde_json::from_str(row.get("payload"))?;
        let i: AnalysisInput = serde_json::from_str(row.get("input"))?;
        if r.id != row.get::<String, _>("id")
            || r.match_key != i.context.match_key
            || r.player_key != i.context.player_key
            || r.input_revision != i.revision
            || r.input_fingerprint != i.fingerprint
        {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
        analysis::validate_evidence(&i, &r)?;
        for e in &r.evidence {
            if snapshot(pool, &e.snapshot_id)
                .await?
                .pointer(&e.path)
                .is_none()
            {
                return Err(AppError::new(ErrorCode::BackupInvalid));
            }
        }
    }
    let rows=sqlx::query("SELECT report_id,evidence_id,match_key,player_key FROM review_notes WHERE report_id IS NOT NULL").fetch_all(pool).await?;
    for row in rows {
        let r = report(pool, row.get("report_id")).await?;
        if r.match_key != row.get::<String, _>("match_key")
            || r.player_key != row.get::<String, _>("player_key")
        {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
        if let Some(id) = row.get::<Option<String>, _>("evidence_id") {
            evidence(
                pool,
                EvidenceQuery {
                    report_id: r.id,
                    evidence_id: id,
                },
            )
            .await?;
        }
    }
    let rows = sqlx::query("SELECT report_id,finding_id FROM review_feedback")
        .fetch_all(pool)
        .await?;
    for row in rows {
        let r = report(pool, row.get("report_id")).await?;
        if !r
            .findings
            .iter()
            .any(|f| f.id == row.get::<String, _>("finding_id"))
        {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
    }
    let goals: Vec<String> = sqlx::query_scalar("SELECT payload FROM training_goals")
        .fetch_all(pool)
        .await?;
    for g in goals {
        let g: TrainingGoal = serde_json::from_str(&g)?;
        for member in &g.baseline {
            validate_member(pool, member, &g.scope.player_key).await?;
        }
    }
    let rows=sqlx::query("SELECT e.payload,g.player_key FROM goal_evaluations e JOIN training_goals g ON g.id=e.goal_id").fetch_all(pool).await?;
    for row in rows {
        let e: GoalEvaluation = serde_json::from_str(row.get("payload"))?;
        for member in &e.members {
            validate_member(pool, member, row.get("player_key")).await?;
        }
    }
    Ok(())
}
async fn validate_member(pool: &SqlitePool, m: &GoalMember, player: &str) -> Result<()> {
    let r = report(pool, &m.report_id).await?;
    if r.player_key != player
        || r.match_key != m.match_key
        || r.input_fingerprint != m.input_fingerprint
    {
        return Err(AppError::new(ErrorCode::BackupInvalid));
    }
    Ok(())
}

pub async fn bootstrap_cached_inputs(pool: &SqlitePool) -> Result<()> {
    let rows:Vec<(String,String)>=sqlx::query_as("SELECT m.projection,p.puuid FROM match_participants m JOIN players p USING(player_key) WHERE NOT EXISTS(SELECT 1 FROM analysis_inputs i WHERE i.match_key=m.match_key AND i.player_key=m.player_key)").fetch_all(pool).await?;
    for (payload, puuid) in rows {
        let m: MatchSummary = serde_json::from_str(&payload)?;
        if let Some(raw) = cached_summary(pool, &m).await?
            && let Ok(i) = analysis::normalize(&raw, None, &m, &puuid)
        {
            let mut tx = pool.begin().await?;
            save_input_tx(&mut tx, i, &m, &raw, None, &m.source).await?;
            tx.commit().await?;
        }
    }
    Ok(())
}
