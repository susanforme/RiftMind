use async_trait::async_trait;
use riftmind_core::{
    contracts::*,
    settings::{self, SettingsStore},
};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, Wry};
use tauri_plugin_store::{Store, StoreExt};
pub struct StoreAdapter<R: Runtime = Wry> {
    store: Arc<Store<R>>,
    path: std::path::PathBuf,
}
impl<R: Runtime> StoreAdapter<R> {
    pub fn new(app: &AppHandle<R>) -> Result<Self> {
        let root = app
            .path()
            .app_config_dir()
            .map_err(|_| AppError::new(ErrorCode::StorageUnavailable))?;
        let path = root.join("settings.json");
        let rollback = path.with_extension("rollback");
        if rollback.exists() && (!path.exists() || validate_file(&path).is_err()) {
            std::fs::copy(&rollback, &path)?;
        }
        if path.exists() && !root.join("restore-journal.json").exists() {
            validate_file(&path)?;
        }
        Ok(Self {
            path,
            store: app
                .store_builder("settings.json")
                .disable_auto_save()
                .build()
                .map_err(|_| AppError::new(ErrorCode::StorageUnavailable))?,
        })
    }
}
#[async_trait]
impl<R: Runtime> SettingsStore for StoreAdapter<R> {
    async fn load(&self) -> Result<Settings> {
        match self.store.get("settings") {
            Some(mut value) => {
                if value.get("schemaVersion").and_then(|v| v.as_u64()) == Some(0) {
                    value["schemaVersion"] = 1.into();
                }
                let settings = serde_json::from_value(value)
                    .map_err(|_| AppError::new(ErrorCode::SettingsInvalid))?;
                settings::validate(&settings)?;
                Ok(settings)
            }
            None => Ok(Settings::default()),
        }
    }
    async fn save(&self, settings: &Settings) -> Result<()> {
        let rollback = self.path.with_extension("rollback");
        if self.path.is_file() {
            tokio::fs::copy(&self.path, &rollback).await?;
        }
        let old = self.store.get("settings");
        self.store.set("settings", serde_json::to_value(settings)?);
        if self.store.save().is_err() {
            if rollback.exists() {
                let _ = tokio::fs::copy(&rollback, &self.path).await;
            }
            if let Some(old) = old {
                self.store.set("settings", old);
            } else {
                self.store.delete("settings");
            }
            return Err(AppError::new(ErrorCode::StorageUnavailable));
        }
        let _ = tokio::fs::remove_file(rollback).await;
        Ok(())
    }
}

fn validate_file(path: &std::path::Path) -> Result<()> {
    if std::fs::metadata(path)?.len() > 65536 {
        return Err(AppError::new(ErrorCode::SettingsInvalid));
    }
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)
        .map_err(|_| AppError::new(ErrorCode::SettingsInvalid))?;
    let mut value = value
        .get("settings")
        .cloned()
        .ok_or(AppError::new(ErrorCode::SettingsInvalid))?;
    if value["schemaVersion"] == 0 {
        value["schemaVersion"] = 1.into();
    }
    let settings: Settings =
        serde_json::from_value(value).map_err(|_| AppError::new(ErrorCode::SettingsInvalid))?;
    settings::validate(&settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn store_plugin_persists_and_refuses_a_failed_save() {
        let directory = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_store::Builder::default().build())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let path = directory.path().join("settings.json");
        let adapter = StoreAdapter {
            path: path.clone(),
            store: app
                .handle()
                .store_builder(&path)
                .disable_auto_save()
                .build()
                .unwrap(),
        };
        let settings = Settings {
            language_preference: "en-US".into(),
            revision: 1,
            ..Settings::default()
        };
        adapter.save(&settings).await.unwrap();
        let persisted: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted["settings"]["languagePreference"], "en-US");
        assert_eq!(adapter.load().await.unwrap().revision, 1);
        let failed = StoreAdapter {
            path: directory.path().join("blocked"),
            store: app
                .handle()
                .store_builder(directory.path().join("blocked"))
                .disable_auto_save()
                .build()
                .unwrap(),
        };
        std::fs::create_dir(directory.path().join("blocked")).unwrap();
        assert!(failed.save(&settings).await.is_err());
    }
}
