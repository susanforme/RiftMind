use crate::{adapters::store::StoreAdapter, app::Host};
use riftmind_core::{contracts::*, services::Service, settings::SettingsStore, storage};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
pub async fn initialize(app: &AppHandle) -> Result<Arc<Service>> {
    let root = app
        .path()
        .app_config_dir()
        .map_err(|_| AppError::new(ErrorCode::StorageUnavailable))?;
    tokio::fs::create_dir_all(&root).await?;
    let store = Arc::new(StoreAdapter::new(app)?);
    riftmind_core::services::recovery::recover_interrupted_restore(&root, store.as_ref()).await?;
    store.load().await?;
    // This check and recoverable backup deliberately precede plugin preload/migrations.
    storage::preflight(&root.join("riftmind.db")).await?;
    if !app
        .state::<Host>()
        .sql_registered
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        app.plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:riftmind.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "stage1",
                            sql: storage::MIGRATION,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "stage2",
                            sql: storage::MIGRATION2,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .map_err(|_| AppError::new(ErrorCode::StorageUnavailable))?;
        app.state::<Host>()
            .sql_registered
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let guard = instances.0.read().await;
    let pool = match guard.get("sqlite:riftmind.db") {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => pool.clone(),
        _ => return Err(AppError::new(ErrorCode::StorageUnavailable)),
    };
    drop(guard);
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await?;
    // SQLx's SQLite defaults enable foreign keys and a finite busy timeout on future connections.
    let mut connections = Vec::new();
    for _ in 0..10 {
        let mut c = pool.acquire().await?;
        sqlx::query("PRAGMA foreign_keys=ON")
            .execute(&mut *c)
            .await?;
        sqlx::query("PRAGMA busy_timeout=3000")
            .execute(&mut *c)
            .await?;
        connections.push(c);
    }
    drop(connections);
    let executable = std::env::current_exe()?;
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::StorageUnavailable))?;
    let assets =
        riftmind_core::services::resources::asset_directory(&executable, project, cfg!(dev))?;
    let service = Service::new_with_assets(pool, root, assets, store).await?;
    if option_env!("RIFTMIND_UPDATE_URL").is_some()
        && option_env!("RIFTMIND_UPDATE_PUBLIC_KEY").is_some()
    {
        service.state.write().await.update_status = UpdateStatus {
            state: "idle".into(),
            version: None,
            downloaded: 0.,
            total: None,
            reason: None,
        };
    }
    Ok(service)
}
