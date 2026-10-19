use crate::contracts::*;
use sha2::{Digest, Sha256};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{
    path::{Path, PathBuf},
    str::FromStr,
    time::Duration,
};
pub const MIGRATION: &str = include_str!("../../../../src-tauri/migrations/0001_workspace.sql");
pub const MIGRATION2: &str =
    include_str!("../../../../src-tauri/migrations/0002_review_training.sql");
pub const MIGRATION_PLAYERS_INSIGHTS: &str =
    include_str!("../../../../src-tauri/migrations/0003_players_insights.sql");
pub const MIGRATION_NOTEBOOKS: &str =
    include_str!("../../../../src-tauri/migrations/0004_champion_notebooks.sql");
pub const MIGRATION_REVIEW_INSIGHTS: &str =
    include_str!("../../../../src-tauri/migrations/0005_review_training_insights.sql");
pub const DATABASE_VERSION: u32 = 8;
pub const MIGRATION_PLAYER_OVERVIEW: &str =
    include_str!("../../../../src-tauri/migrations/0008_player_overview.sql");
pub const MIGRATION_CHAMPION_BUILD_SYNC: &str =
    include_str!("../../../../src-tauri/migrations/0007_champion_build_sync.sql");
pub const MIGRATION_PLAYER_IDENTITY: &str =
    include_str!("../../../../src-tauri/migrations/0006_player_identity.sql");
pub const SCHEMA_MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "workspace", MIGRATION),
    (2, "review_training", MIGRATION2),
    (3, "players_insights", MIGRATION_PLAYERS_INSIGHTS),
    (4, "champion_notebooks", MIGRATION_NOTEBOOKS),
    (5, "review_training_insights", MIGRATION_REVIEW_INSIGHTS),
    (6, "player_identity", MIGRATION_PLAYER_IDENTITY),
    (7, "champion_build_sync", MIGRATION_CHAMPION_BUILD_SYNC),
    (8, "player_overview", MIGRATION_PLAYER_OVERVIEW),
];
#[derive(Debug)]
struct WorkspaceMigrations;
impl sqlx::migrate::MigrationSource<'static> for WorkspaceMigrations {
    fn resolve(
        self,
    ) -> futures_util::future::BoxFuture<
        'static,
        std::result::Result<Vec<sqlx::migrate::Migration>, sqlx::error::BoxDynError>,
    > {
        Box::pin(async {
            Ok(SCHEMA_MIGRATIONS
                .iter()
                .map(|(version, description, sql)| {
                    sqlx::migrate::Migration::new(
                        *version,
                        (*description).into(),
                        sqlx::migrate::MigrationType::ReversibleUp,
                        (*sql).into(),
                        false,
                    )
                })
                .collect())
        })
    }
}
pub mod review;
pub const TABLES: &[&str] = &[
    "players",
    "matches",
    "match_participants",
    "source_snapshots",
    "match_revisions",
    "jobs",
    "sync_state",
    "resource_manifests",
    "snapshot_refs",
    "analysis_inputs",
    "detail_attempts",
    "reviews",
    "review_notes",
    "review_feedback",
    "training_goals",
    "goal_evaluations",
    "favorites",
    "player_profiles",
    "notebook_entries",
    "notebook_revisions",
    "practice_entries",
    "build_applications",
    "personal_baselines",
    "preparation_batches",
    "champion_build_rules",
    "local_accounts",
    "rank_snapshots",
];
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub async fn connect(path: &Path) -> Result<SqlitePool> {
    let opt = SqliteConnectOptions::from_str("sqlite:")?
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(3));
    Ok(SqlitePoolOptions::new()
        .max_connections(4)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys=ON")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA busy_timeout=3000")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect_with(opt)
        .await?)
}
pub async fn preflight(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
        .await?;
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&pool)
        .await?;
    let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(&pool)
        .await?;
    if version > i64::from(DATABASE_VERSION) || integrity != "ok" {
        pool.close().await;
        return Err(AppError::new(ErrorCode::BackupInvalid));
    }
    if version < i64::from(DATABASE_VERSION) {
        let backup = path.with_extension(format!("pre-migration-{}.db", uuid::Uuid::new_v4()));
        vacuum_backup(&pool, &backup).await?;
        if let Some(root) = path.parent() {
            let settings = root.join("settings.json");
            if settings.exists() {
                tokio::fs::copy(settings, backup.with_extension("settings.json")).await?;
            }
        }
    }
    pool.close().await;
    Ok(())
}
pub async fn open(path: &Path) -> Result<SqlitePool> {
    preflight(path).await?;
    let pool = connect(path).await?;
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&pool)
        .await?;
    let registered: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations')",
    )
    .fetch_one(&pool)
    .await?;
    if registered {
        // Desktop backups retain SQLx metadata; upgrading only user_version would replay DDL on recovery.
        let migrator = sqlx::migrate::Migrator::new(WorkspaceMigrations)
            .await
            .map_err(|_| AppError::new(ErrorCode::StorageCorrupt))?;
        migrator
            .run(&pool)
            .await
            .map_err(|_| AppError::new(ErrorCode::StorageCorrupt))?;
    } else {
        let mut tx = pool.begin().await?;
        for (migration_version, _, sql) in SCHEMA_MIGRATIONS {
            if version < *migration_version {
                sqlx::Executor::execute(&mut *tx, *sql).await?;
            }
        }
        tx.commit().await?;
    }
    if version < 2 {
        review::bootstrap_cached_inputs(&pool).await?;
    }
    Ok(pool)
}
pub async fn vacuum_backup(pool: &SqlitePool, path: &Path) -> Result<()> {
    let p = path.to_string_lossy().replace('\'', "''");
    sqlx::query(&format!("VACUUM INTO '{p}'"))
        .execute(pool)
        .await?;
    Ok(())
}
pub async fn save_player(pool: &SqlitePool, player: &Player) -> Result<Player> {
    let row = sqlx::query(
        "INSERT INTO players (player_key,server_id,puuid,display_name,updated_at,profile_icon_id,summoner_level) \
         VALUES(?,?,?,?,?,?,?) ON CONFLICT(player_key) DO UPDATE SET \
         display_name=COALESCE(NULLIF(excluded.display_name,''),players.display_name),\
         updated_at=excluded.updated_at,\
         profile_icon_id=COALESCE(excluded.profile_icon_id,players.profile_icon_id),\
         summoner_level=COALESCE(excluded.summoner_level,players.summoner_level) \
         RETURNING player_key,server_id,puuid,display_name,updated_at,profile_icon_id,summoner_level",
    )
    .bind(&player.player_key)
    .bind(&player.server_id)
    .bind(&player.puuid)
    .bind(&player.display_name)
    .bind(&player.updated_at)
    .bind(player.profile_icon_id)
    .bind(player.summoner_level)
    .fetch_one(pool)
    .await?;
    Ok(player_from_row(&row))
}
fn player_from_row(row: &sqlx::sqlite::SqliteRow) -> Player {
    Player {
        player_key: row.get("player_key"),
        server_id: row.get("server_id"),
        puuid: row.get("puuid"),
        display_name: row.get("display_name"),
        profile_icon_id: row.get("profile_icon_id"),
        summoner_level: row.get("summoner_level"),
        updated_at: row.get("updated_at"),
    }
}
pub async fn players(pool: &SqlitePool) -> Result<Vec<Player>> {
    let rows = sqlx::query("SELECT player_key,server_id,puuid,display_name,updated_at,profile_icon_id,summoner_level FROM players ORDER BY updated_at DESC,player_key")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(player_from_row).collect())
}
pub async fn list(pool: &SqlitePool, mut q: MatchQuery) -> Result<MatchPage> {
    crate::domain::validate_key(&q.player_key)?;
    if q.position.as_ref().is_some_and(|s| {
        !["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY", "UNKNOWN"].contains(&s.as_str())
    }) || q.patch.as_ref().is_some_and(|s| {
        s.len() > 20 || s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit() || b == b'.')
    }) {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    let limit = q.page_size.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    for date in [&mut q.from, &mut q.to] {
        if let Some(value) = date.as_ref() {
            if value.len() > 40 {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            let parsed = chrono::DateTime::parse_from_rfc3339(value)
                .map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
            *date = Some(
                parsed
                    .with_timezone(&chrono::Utc)
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            );
        }
    }
    if let (Some(a), Some(b)) = (&q.from, &q.to)
        && a > b
    {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    let cursor = if let Some(s) = q.cursor {
        if s.len() > 2048 {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let c: Vec<String> = serde_json::from_str(&s)?;
        if c.len() != 4
            || c[0] != q.player_key
            || c[1]
                != hash(
                    serde_json::to_string(&(
                        &q.queue_id,
                        &q.champion_id,
                        &q.from,
                        &q.to,
                        &q.position,
                        &q.patch,
                    ))?
                    .as_bytes(),
                )
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        Some(c)
    } else {
        None
    };
    let mut b = sqlx::QueryBuilder::new(
        "SELECT p.projection,m.started_at,m.match_key FROM match_participants p JOIN matches m USING(match_key) WHERE p.player_key=",
    );
    b.push_bind(&q.player_key);
    macro_rules! filter {
        ($v:expr,$sql:expr) => {
            if let Some(v) = $v {
                b.push($sql).push_bind(v);
            }
        };
    }
    filter!(q.queue_id, " AND m.queue_id=");
    filter!(q.champion_id, " AND p.champion_id=");
    filter!(&q.from, " AND m.started_at>=");
    filter!(&q.to, " AND m.started_at<=");
    filter!(
        &q.position,
        " AND COALESCE(NULLIF(p.position,''),'UNKNOWN')="
    );
    if let Some(patch) = &q.patch {
        b.push(" AND (m.version=")
            .push_bind(patch)
            .push(" OR m.version LIKE ")
            .push_bind(format!("{patch}.%"))
            .push(")");
    }
    // Count shares the same validated filters; cursor never changes the total.
    let total:i64=sqlx::query_scalar("SELECT COUNT(*) FROM match_participants p JOIN matches m USING(match_key) WHERE p.player_key=? AND (? IS NULL OR m.queue_id=?) AND (? IS NULL OR p.champion_id=?) AND (? IS NULL OR m.started_at>=?) AND (? IS NULL OR m.started_at<=?) AND (? IS NULL OR COALESCE(NULLIF(p.position,''),'UNKNOWN')=?) AND (? IS NULL OR m.version=? OR m.version LIKE ?)").bind(&q.player_key).bind(q.queue_id).bind(q.queue_id).bind(q.champion_id).bind(q.champion_id).bind(&q.from).bind(&q.from).bind(&q.to).bind(&q.to).bind(&q.position).bind(&q.position).bind(&q.patch).bind(&q.patch).bind(q.patch.as_ref().map(|p|format!("{p}.%"))).fetch_one(pool).await?;
    if let Some(c) = &cursor {
        b.push(" AND (m.started_at < ")
            .push_bind(&c[2])
            .push(" OR (m.started_at = ")
            .push_bind(&c[2])
            .push(" AND m.match_key < ")
            .push_bind(&c[3])
            .push("))");
    }
    b.push(" ORDER BY m.started_at DESC,m.match_key DESC LIMIT ")
        .push_bind(limit + 1);
    let rows = b.build().fetch_all(pool).await?;
    let more = rows.len() > limit as usize;
    let mut items: Vec<MatchSummary> = rows
        .iter()
        .take(limit as usize)
        .map(|r| serde_json::from_str(r.get("projection")))
        .collect::<std::result::Result<_, _>>()?;
    for item in &mut items {
        let revisions: (Option<i64>, Option<i64>) = sqlx::query_as("SELECT (SELECT MAX(revision) FROM analysis_inputs WHERE match_key=? AND player_key=?),(SELECT MAX(i.revision) FROM reviews r JOIN analysis_inputs i ON i.id=r.input_id WHERE r.match_key=? AND r.player_key=?)").bind(&item.match_key).bind(&item.player_key).bind(&item.match_key).bind(&item.player_key).fetch_one(pool).await?;
        item.review_state = Some(
            if revisions.1.is_none() {
                "missing"
            } else if revisions.0 > revisions.1 {
                "new_data"
            } else {
                "ready"
            }
            .into(),
        );
    }
    let next_cursor = if more {
        let last = items.last().unwrap();
        Some(serde_json::to_string(&[
            q.player_key.clone(),
            hash(
                serde_json::to_string(&(
                    &q.queue_id,
                    &q.champion_id,
                    &q.from,
                    &q.to,
                    &q.position,
                    &q.patch,
                ))?
                .as_bytes(),
            ),
            last.started_at.clone(),
            last.match_key.clone(),
        ])?)
    } else {
        None
    };
    let coverage = sqlx::query("SELECT * FROM sync_state WHERE player_key=?")
        .bind(&q.player_key)
        .fetch_optional(pool)
        .await?
        .map(|r| Coverage {
            last_sync: r.get("last_sync"),
            pages: r.get::<i64, _>("pages") as u32,
            matches_count: r.get::<i64, _>("matches_count") as u32,
            exhausted: r.get("exhausted"),
        });
    let last_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM jobs WHERE player_key=? AND kind='sync' ORDER BY updated_at DESC,id DESC LIMIT 1",
    )
    .bind(&q.player_key)
    .fetch_optional(pool)
    .await?;
    let last_task = if let Some(id) = last_id {
        Some(task(pool, &id).await?)
    } else {
        None
    };
    Ok(MatchPage {
        items,
        next_cursor,
        total: total as u32,
        coverage,
        last_task,
    })
}
pub async fn commit_page(
    pool: &SqlitePool,
    task: &Task,
    items: &[MatchSummary],
    raw: &serde_json::Value,
    exhausted: bool,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    let payload = serde_json::to_string(raw)?;
    let source = match items.first().map(|item| &item.source) {
        Some(Source::Sgp) => "sgp",
        Some(Source::Lcu) => "lcu",
        None => "summary",
    };
    let h = hash(format!("{source}:{payload}").as_bytes());
    sqlx::query("INSERT OR IGNORE INTO source_snapshots VALUES(?,?,?,?)")
        .bind(&h)
        .bind(source)
        .bind(payload)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    for item in items {
        let old=sqlx::query("SELECT projection,revision,source FROM match_participants WHERE match_key=? AND player_key=?").bind(&item.match_key).bind(&item.player_key).fetch_optional(&mut *tx).await?;
        let mut item = item.clone();
        let mut changed = true;
        if let Some(r) = old {
            let mut prev: MatchSummary = serde_json::from_str(r.get("projection"))?;
            item.revision = prev.revision;
            changed = serde_json::to_value(&prev)? != serde_json::to_value(&item)?;
            if prev.source == Source::Sgp && item.source == Source::Lcu {
                changed = false;
            }
            if changed {
                prev.revision += 1;
                item.revision = prev.revision;
            }
        }
        if !changed {
            continue;
        }
        sqlx::query("INSERT INTO matches VALUES(?,?,?,?,?,?) ON CONFLICT(match_key) DO UPDATE SET started_at=excluded.started_at,queue_id=COALESCE(excluded.queue_id,matches.queue_id),version=CASE WHEN excluded.version='unknown' THEN matches.version ELSE excluded.version END")
            .bind(&item.match_key)
            .bind(&item.server_id)
            .bind(&item.game_id)
            .bind(&item.started_at)
            .bind(item.queue_id)
            .bind(&item.version)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO match_participants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(match_key,player_key) DO UPDATE SET champion_id=excluded.champion_id,outcome=excluded.outcome,kills=excluded.kills,deaths=excluded.deaths,assists=excluded.assists,duration=excluded.duration,position=excluded.position,cs=excluded.cs,items=excluded.items,source=excluded.source,fallback_reason=excluded.fallback_reason,revision=excluded.revision,projection=excluded.projection").bind(&item.match_key).bind(&item.player_key).bind(item.champion_id).bind(format!("{:?}",item.outcome)).bind(item.kills).bind(item.deaths).bind(item.assists).bind(item.duration).bind(&item.position).bind(item.cs).bind(serde_json::to_string(&item.items)?).bind(if item.source==Source::Sgp{"sgp"}else{"lcu"}).bind(&item.fallback_reason).bind(item.revision).bind(serde_json::to_string(&item)?).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO match_revisions VALUES(?,?,?,?)")
            .bind(&item.match_key)
            .bind(&item.player_key)
            .bind(item.revision)
            .bind(&h)
            .execute(&mut *tx)
            .await?;
        let existing: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM analysis_inputs WHERE match_key=? AND player_key=?)",
        )
        .bind(&item.match_key)
        .bind(&item.player_key)
        .fetch_one(&mut *tx)
        .await?;
        if !existing {
            let puuid: String = sqlx::query_scalar("SELECT puuid FROM players WHERE player_key=?")
                .bind(&item.player_key)
                .fetch_one(&mut *tx)
                .await?;
            if let Some(summary) = review::match_from_page(raw, &item.game_id)
                && let Ok(input) = crate::domain::analysis::normalize(&summary, None, &item, &puuid)
            {
                review::save_input_tx(&mut tx, input, &item, &summary, None, &item.source).await?;
            }
        }
    }
    sqlx::query("UPDATE jobs SET checkpoint=?,updated_at=? WHERE id=?")
        .bind(task.checkpoint)
        .bind(now())
        .bind(&task.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO sync_state VALUES(?,?,?,(SELECT COUNT(*) FROM match_participants WHERE player_key=?),?) ON CONFLICT(player_key) DO UPDATE SET last_sync=excluded.last_sync,pages=excluded.pages,matches_count=excluded.matches_count,exhausted=excluded.exhausted").bind(task.player_key.as_ref()).bind(now()).bind(task.checkpoint).bind(task.player_key.as_ref()).bind(exhausted).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
pub async fn task(pool: &SqlitePool, id: &str) -> Result<Task> {
    crate::domain::validate_key(id)?;
    let r = sqlx::query("SELECT * FROM jobs WHERE id=?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(Task {
        stage: r.get("stage"),
        retry_at: r.get("retry_at"),
        id: r.get("id"),
        kind: serde_json::from_value(serde_json::Value::String(r.get("kind")))?,
        result: r
            .get::<Option<String>, _>("result")
            .map(|s| serde_json::from_str(&s))
            .transpose()?,
        player_key: r.get("player_key"),
        state: serde_json::from_value(serde_json::Value::String(r.get("state")))?,
        checkpoint: r.get::<i64, _>("checkpoint") as u32,
        budget: r.get::<i64, _>("budget") as u32,
        session_epoch: r.get("session_epoch"),
        updated_at: r.get("updated_at"),
        error: r
            .get::<Option<String>, _>("error")
            .map(|s| serde_json::from_str(&s))
            .transpose()?,
    })
}
pub async fn bytes(path: PathBuf) -> u64 {
    let mut size = 0;
    let mut stack = vec![path];
    while let Some(p) = stack.pop() {
        if let Ok(m) = tokio::fs::symlink_metadata(&p).await {
            if m.is_file() {
                size += m.len()
            } else if m.is_dir()
                && let Ok(mut dir) = tokio::fs::read_dir(p).await
            {
                while let Ok(Some(e)) = dir.next_entry().await {
                    stack.push(e.path())
                }
            }
        }
    }
    size
}
