use crate::{contracts::*, settings, storage};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::Path;
pub async fn validate_bundle(bytes: &[u8], candidate: &Path) -> Result<Settings> {
    if bytes.len() > 128 * 1024 * 1024 {
        return Err(AppError::new(ErrorCode::BackupInvalid));
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| AppError::new(ErrorCode::BackupInvalid))?;
    let db = STANDARD
        .decode(
            value["database"]
                .as_str()
                .ok_or(AppError::new(ErrorCode::BackupInvalid))?,
        )
        .map_err(|_| AppError::new(ErrorCode::BackupInvalid))?;
    if !value["schemaVersion"]
        .as_u64()
        .is_some_and(|version| (1..=u64::from(storage::DATABASE_VERSION)).contains(&version))
        || value["sha256"] != storage::hash(&db)
    {
        return Err(AppError::new(ErrorCode::BackupInvalid));
    }
    let settings: Settings = serde_json::from_value(value["settings"].clone())
        .map_err(|_| AppError::new(ErrorCode::BackupInvalid))?;
    settings::validate(&settings)?;
    tokio::fs::write(candidate, db).await?;
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(candidate)
                .read_only(true),
        )
        .await?;
    let outcome: Result<()> = async {
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await?;
        if !(1..=i64::from(storage::DATABASE_VERSION)).contains(&version) {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
        let check: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&pool)
            .await?;
        if check != "ok"
            || !sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&pool)
                .await?
                .is_empty()
        {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
        let tables: Vec<&'static str> = storage::TABLES[..if version == 1 {
            8
        } else if version == 2 {
            16
        } else if version == 3 {
            18
        } else if version == 4 {
            22
        } else {
            storage::TABLES.len()
        }]
            .to_vec();
        for table in tables {
            sqlx::query(&format!("SELECT * FROM {table} LIMIT 0"))
                .execute(&pool)
                .await?;
        }
        Ok(())
    }
    .await;
    pool.close().await;
    outcome?;
    let upgraded = storage::open(candidate).await?;
    let evidence = storage::review::validate_business_evidence(&upgraded).await;
    let notebooks = super::notebooks::validate_saved_notebooks(&upgraded).await;
    let insights = super::review_insights::validate_saved_insights(&upgraded).await;
    upgraded.close().await;
    insights.map_err(|_| AppError::new(ErrorCode::BackupInvalid))?;
    notebooks.map_err(|_| AppError::new(ErrorCode::BackupInvalid))?;
    evidence.map_err(|_| AppError::new(ErrorCode::BackupInvalid))?;
    Ok(settings)
}

pub async fn recover_interrupted_restore(
    root: &Path,
    store: &dyn settings::SettingsStore,
) -> Result<bool> {
    let journal = root.join("restore-journal.json");
    if !journal.exists() {
        return Ok(false);
    }
    let value: Value = serde_json::from_slice(&tokio::fs::read(&journal).await?)?;
    let id = value["rollbackBackup"]
        .as_str()
        .ok_or(AppError::new(ErrorCode::BackupInvalid))?;
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(AppError::new(ErrorCode::BackupInvalid));
    }
    let file = root.join("backups").join(format!("{id}.riftmind"));
    if tokio::fs::metadata(&file).await?.len() > 128 * 1024 * 1024 {
        return Err(AppError::new(ErrorCode::BackupInvalid));
    }
    let candidate = root.join(format!("rollback-{}.db", uuid::Uuid::new_v4()));
    let settings = validate_bundle(&tokio::fs::read(file).await?, &candidate).await?;
    // No pools are open yet. Keep every old file until both database and settings have been restored.
    let preserved = root
        .join("backups")
        .join(format!("interrupted-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&preserved).await?;
    for name in [
        "riftmind.db",
        "riftmind.db-wal",
        "riftmind.db-shm",
        "settings.json",
    ] {
        if root.join(name).exists() {
            tokio::fs::copy(root.join(name), preserved.join(name)).await?;
        }
    }
    for name in ["riftmind.db-wal", "riftmind.db-shm"] {
        if root.join(name).exists() {
            tokio::fs::remove_file(root.join(name)).await?;
        }
    }
    tokio::fs::copy(&candidate, root.join("riftmind.db")).await?;
    store.save(&settings).await?;
    tokio::fs::remove_file(&candidate).await?;
    tokio::fs::remove_file(journal).await?;
    Ok(true)
}
