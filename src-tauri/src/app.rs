use riftmind_core::{contracts::*, services::Service};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::RwLock;
struct TrayLabels {
    exit: MenuItem<tauri::Wry>,
}

pub struct Host {
    pub service: RwLock<Option<Arc<Service>>>,
    pub phase: RwLock<AppPhase>,
    pub sql_registered: AtomicBool,
    pub quitting: AtomicBool,
}
#[tauri::command]
pub async fn dispatch(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request: Command,
) -> Result<serde_json::Value> {
    if window.label() != "main" {
        return Err(AppError::new(ErrorCode::Forbidden));
    }
    let host = app.state::<Host>();
    let service = host.service.read().await.clone();
    if let Command::get_app_state(_) = &request {
        if service.is_none() {
            return Ok(serde_json::to_value(AppState {
                phase: host.phase.read().await.clone(),
                runtime_id: "bootstrap".into(),
                workspace_epoch: "bootstrap".into(),
                app_version: env!("CARGO_PKG_VERSION").into(),
                database_version: 5,
                settings_version: 1,
                update_status: UpdateStatus {
                    state: "unavailable".into(),
                    version: None,
                    downloaded: 0.,
                    total: None,
                    reason: Some(ErrorCode::UpdateNotConfigured),
                },
            })?);
        }
    }
    if service.is_none() {
        if let Command::restore_backup(_) = request {
            let selected = app
                .dialog()
                .file()
                .add_filter("RiftMind", &["riftmind"])
                .blocking_pick_file()
                .ok_or(AppError::new(ErrorCode::Cancelled))?;
            let path = selected
                .into_path()
                .map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
            if tokio::fs::metadata(&path).await?.len() > 128 * 1024 * 1024 {
                return Err(AppError::new(ErrorCode::BackupInvalid));
            }
            let root = app
                .path()
                .app_config_dir()
                .map_err(|_| AppError::new(ErrorCode::StorageUnavailable))?;
            tokio::fs::create_dir_all(&root).await?;
            let id = uuid::Uuid::new_v4().to_string();
            let candidate = root.join(format!("recovery-{id}.db"));
            let settings = riftmind_core::services::recovery::validate_bundle(
                &tokio::fs::read(path).await?,
                &candidate,
            )
            .await?;
            let old = root.join(format!("before-recovery-{id}"));
            tokio::fs::create_dir_all(&old).await?;
            for name in [
                "riftmind.db",
                "riftmind.db-wal",
                "riftmind.db-shm",
                "settings.json",
            ] {
                if root.join(name).exists() {
                    tokio::fs::copy(root.join(name), old.join(name)).await?;
                }
            }
            if host.sql_registered.load(Ordering::SeqCst) {
                return Err(AppError::new(ErrorCode::AppNotReady));
            }
            for name in ["riftmind.db-wal", "riftmind.db-shm"] {
                let _ = tokio::fs::remove_file(root.join(name)).await;
            }
            if root.join("riftmind.db").exists() {
                tokio::fs::remove_file(root.join("riftmind.db")).await?;
            }
            tokio::fs::rename(candidate, root.join("riftmind.db")).await?;
            use riftmind_core::settings::SettingsStore;
            crate::adapters::store::StoreAdapter::new(&app)?
                .save(&settings)
                .await?;
            let s = crate::bootstrap::initialize(&app).await?;
            let epoch = s.state.read().await.workspace_epoch.clone();
            *host.service.write().await = Some(s.clone());
            *host.phase.write().await = AppPhase::Ready;
            attach_service(&app, s);
            return Ok(serde_json::to_value(completed_recovery(
                MaintenanceResult {
                    reference: id,
                    workspace_epoch: epoch,
                },
                JobKind::Restore,
            ))?);
        }
        if let Command::export_diagnostics(_) = request {
            let target = save_path(&app, "riftmind-recovery.json", "json")?;
            let id = uuid::Uuid::new_v4().to_string();
            tokio::fs::write(target,serde_json::to_vec(&serde_json::json!({"appVersion":env!("CARGO_PKG_VERSION"),"phase":*host.phase.read().await,"requestId":id}))?).await?;
            return Ok(serde_json::to_value(completed_recovery(
                MaintenanceResult {
                    reference: id,
                    workspace_epoch: "bootstrap".into(),
                },
                JobKind::Diagnostics,
            ))?);
        }
        return Err(AppError::new(ErrorCode::AppNotReady));
    }
    let service = service.unwrap();
    match request {
        Command::save_item_build_file(query) => {
            let build = service.export_build(query).await?;
            if !build.issues.is_empty() {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            let target = save_path(&app, "item-set.json", "json")?;
            tokio::fs::write(target, build.json).await?;
            Ok(serde_json::json!({}))
        }
        Command::save_champion_notebook_file(query) => {
            let notebook = service.export_notebook(query).await?;
            let target = save_path(&app, "champion-notebook.json", "json")?;
            tokio::fs::write(target, serde_json::to_vec_pretty(&notebook)?).await?;
            Ok(serde_json::json!({}))
        }

        Command::check_for_updates(_) => {
            let status = crate::adapters::updates::check(&app, false).await?;
            service.state.write().await.update_status = status.clone();
            service.emit("update-changed", None, 0).await;
            Ok(serde_json::to_value(status)?)
        }
        Command::install_update(_) => Ok(serde_json::to_value(
            crate::adapters::updates::check(&app, true).await?,
        )?),
        Command::create_backup(_) => {
            let target = save_path(&app, "workspace.riftmind", "riftmind")?;
            let task = service.start_maintenance(JobKind::Backup, None).await?;
            let result = service.await_task(&task.id).await?;
            tokio::fs::copy(
                service
                    .root
                    .join("backups")
                    .join(format!("{}.riftmind", result.reference)),
                target,
            )
            .await?;
            Ok(serde_json::to_value(
                riftmind_core::storage::task(&service.pool, &task.id).await?,
            )?)
        }
        Command::export_diagnostics(_) => {
            let target = save_path(&app, "riftmind-diagnostics.json", "json")?;
            let task = service
                .start_maintenance(JobKind::Diagnostics, None)
                .await?;
            let result = service.await_task(&task.id).await?;
            tokio::fs::copy(
                service
                    .root
                    .join("backups")
                    .join(format!("{}.diagnostics.json", result.reference)),
                target,
            )
            .await?;
            Ok(serde_json::to_value(
                riftmind_core::storage::task(&service.pool, &task.id).await?,
            )?)
        }
        Command::restore_backup(_) => {
            let selected = app
                .dialog()
                .file()
                .add_filter("RiftMind", &["riftmind"])
                .blocking_pick_file()
                .ok_or(AppError::new(ErrorCode::Cancelled))?;
            let path = selected
                .into_path()
                .map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
            if tokio::fs::metadata(&path).await?.len() > 128 * 1024 * 1024 {
                return Err(AppError::new(ErrorCode::BackupInvalid));
            }
            let id = uuid::Uuid::new_v4().to_string();
            tokio::fs::copy(
                path,
                service.root.join("backups").join(format!("{id}.riftmind")),
            )
            .await?;
            Ok(serde_json::to_value(
                service
                    .start_maintenance(JobKind::Restore, Some(id))
                    .await?,
            )?)
        }
        other => {
            let result = service.dispatch(other).await;
            if let Err(e) = &result {
                log::warn!("request={} code={:?}", e.request_id, e.code);
            }
            result
        }
    }
}
fn save_path(app: &tauri::AppHandle, name: &str, extension: &str) -> Result<PathBuf> {
    app.dialog()
        .file()
        .set_file_name(name)
        .add_filter("RiftMind", &[extension])
        .blocking_save_file()
        .ok_or(AppError::new(ErrorCode::Cancelled))?
        .into_path()
        .map_err(|_| AppError::new(ErrorCode::InvalidInput))
}
fn quit(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let host = handle.state::<Host>();
        host.quitting.store(true, Ordering::SeqCst);
        if let Some(s) = host.service.read().await.clone() {
            if let Err(e) = s.shutdown().await {
                log::error!("shutdown request={} code={:?}", e.request_id, e.code);
                host.quitting.store(false, Ordering::SeqCst);
                return;
            }
        }
        handle.exit(0);
    });
}
pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("cdragon", |context, request, responder| {
            let app = context.app_handle().clone();
            let main_window = context.webview_label() == "main";
            tauri::async_runtime::spawn(async move {
                responder
                    .respond(crate::adapters::resources::respond(&app, main_window, request).await);
            });
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .manage(Host {
            service: RwLock::new(None),
            phase: RwLock::new(AppPhase::Booting),
            sql_registered: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "RiftMind", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "退出 / Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &exit])?;
            app.manage(TrayLabels { exit: exit.clone() });
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("RiftMind")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "exit" => quit(app),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                *handle.state::<Host>().phase.write().await = AppPhase::Migrating;
                match crate::bootstrap::initialize(&handle).await {
                    Ok(service) => {
                        *handle.state::<Host>().service.write().await = Some(service.clone());
                        *handle.state::<Host>().phase.write().await = AppPhase::Ready;
                        attach_service(&handle, service);
                    }
                    Err(e) => {
                        *handle.state::<Host>().phase.write().await = AppPhase::RecoveryRequired;
                        log::error!("bootstrap request={} code={:?}", e.request_id, e.code);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let host = app.state::<Host>();
                if host.quitting.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let host = handle.state::<Host>();
                    let tray = if let Some(s) = host.service.read().await.clone() {
                        s.settings.lock().await.close_behavior == CloseBehavior::Tray
                    } else {
                        false
                    };
                    if tray {
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    } else {
                        quit(&handle)
                    }
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to initialize RiftMind host")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<Host>().quitting.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    quit(app);
                }
            }
        });
}

fn attach_service(app: &tauri::AppHandle, service: Arc<Service>) {
    let labels_app = app.clone();
    let labels_service = service.clone();
    tauri::async_runtime::spawn(async move {
        update_native_labels(&labels_app, &labels_service).await;
    });
    let h = app.clone();
    let mut events = service.events.subscribe();
    let label_service = service.clone();
    tauri::async_runtime::spawn(async move {
        while let Ok(e) = events.recv().await {
            if e.kind == "settings-changed" {
                update_native_labels(&h, &label_service).await;
            }
            let _ = h.emit_to("main", "riftmind-event", e);
        }
    });
    tauri::async_runtime::spawn(crate::adapters::discovery::monitor(service));
}

fn completed_recovery(result: MaintenanceResult, kind: JobKind) -> Task {
    Task {
        stage: None,
        retry_at: None,
        id: result.reference.clone(),
        player_key: None,
        kind,
        state: JobState::Completed,
        checkpoint: 1,
        budget: 1,
        session_epoch: result.workspace_epoch.clone(),
        updated_at: riftmind_core::storage::now(),
        error: None,
        result: Some(result),
    }
}

async fn update_native_labels(app: &tauri::AppHandle, service: &Service) {
    let settings = service.settings.lock().await.clone();
    let locale = if settings.language_preference == "system" {
        system_locale()
    } else {
        settings.language_preference
    };
    let source = if locale.to_lowercase().starts_with("zh") {
        include_str!("../../src/i18n/locales/zh-CN/settings.json")
    } else {
        include_str!("../../src/i18n/locales/en-US/settings.json")
    };
    if let Ok(messages) = serde_json::from_str::<serde_json::Value>(source) {
        if let Some(text) = messages["exit"].as_str() {
            let _ = app.state::<TrayLabels>().exit.set_text(text);
        }
    }
}
fn system_locale() -> String {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetUserDefaultLocaleName(buffer: *mut u16, length: i32) -> i32;
        }
        let mut buffer = [0_u16; 85];
        let length = unsafe { GetUserDefaultLocaleName(buffer.as_mut_ptr(), buffer.len() as i32) };
        if length > 1 {
            return String::from_utf16_lossy(&buffer[..length as usize - 1]);
        }
    }
    "zh-CN".into()
}
