use crate::contracts::*;
use async_trait::async_trait;
use std::path::PathBuf;
#[async_trait]
pub trait SettingsStore: Send + Sync {
    async fn load(&self) -> Result<Settings>;
    async fn save(&self, settings: &Settings) -> Result<()>;
}
pub struct JsonSettingsStore(pub PathBuf);
#[async_trait]
impl SettingsStore for JsonSettingsStore {
    async fn load(&self) -> Result<Settings> {
        match tokio::fs::read(&self.0).await {
            Ok(bytes) => {
                if bytes.len() > 65536 {
                    return Err(AppError::new(ErrorCode::SettingsInvalid));
                }
                let mut v: serde_json::Value = serde_json::from_slice(&bytes)?;
                if v.get("schemaVersion").and_then(|v| v.as_u64()) == Some(0) {
                    v["schemaVersion"] = 1.into();
                }
                let s: Settings = serde_json::from_value(v)
                    .map_err(|_| AppError::new(ErrorCode::SettingsInvalid))?;
                validate(&s)?;
                Ok(s)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(e) => Err(e.into()),
        }
    }
    async fn save(&self, s: &Settings) -> Result<()> {
        let tmp = self.0.with_extension("pending");
        tokio::fs::write(&tmp, serde_json::to_vec_pretty(s)?).await?;
        tokio::fs::rename(tmp, &self.0).await?;
        Ok(())
    }
}
pub fn validate(s: &Settings) -> Result<()> {
    if s.schema_version != 1
        || !["system", "zh-CN", "en-US"].contains(&s.language_preference.as_str())
        || !(1..=20).contains(&s.sync_pages)
        || s.workspace_tabs.len() > 20
        || s.active_tab.len() > 256
    {
        return Err(AppError::new(ErrorCode::SettingsInvalid));
    }
    let mut ids = std::collections::HashSet::new();
    for tab in &s.workspace_tabs {
        crate::domain::validate_key(&tab.id)?;
        if !ids.insert(&tab.id)
            || ![
                "matches",
                "settings",
                "review",
                "progress",
                "live",
                "champions",
                "players",
                "compare",
                "notebooks",
            ]
            .contains(&tab.kind.as_str())
            || tab.search.len() > 2048
            || tab.search.contains(['<', '>'])
        {
            return Err(AppError::new(ErrorCode::SettingsInvalid));
        }
        if let Some(k) = &tab.player_key {
            crate::domain::validate_key(k)?;
        }
    }
    Ok(())
}
pub fn apply(current: &Settings, req: UpdateSettings) -> Result<Settings> {
    if req.expected_revision != current.revision {
        return Err(AppError::new(ErrorCode::SettingsConflict));
    }
    let mut next = current.clone();
    let p = req.patch;
    macro_rules! patch{($($f:ident),*)=>{$(if let Some(v)=p.$f{next.$f=v;})*};}
    patch!(
        language_preference,
        theme_id,
        color_mode_preference,
        sidebar_collapsed,
        close_behavior,
        auto_connect,
        auto_sync,
        sync_pages,
        workspace_tabs,
        active_tab
    );
    if next.theme_id != "default" {
        next.theme_id = "default".into();
    }
    next.revision += 1;
    validate(&next)?;
    Ok(next)
}
