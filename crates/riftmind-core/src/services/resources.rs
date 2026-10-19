use crate::contracts::*;
use serde_json::Value;
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Weak},
    time::{Duration, Instant},
};
use tokio::{
    io::AsyncWriteExt,
    sync::{Mutex, Semaphore},
};

const PREFIX: &str = "plugins/rcp-be-lol-game-data/global/";
const MAX_BYTES: usize = 8 * 1024 * 1024;
pub const PROTOCOL_ORIGIN: &str = "http://cdragon.localhost";

pub struct ResourceFile {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}
pub struct ResourceResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}
pub struct ResourceClient {
    base: String,
    client: reqwest::Client,
    gate: Semaphore,
    flights: Mutex<HashMap<String, Weak<Mutex<()>>>>,
    failures: Mutex<HashMap<String, (Instant, ErrorCode)>>,
    metadata: Mutex<HashMap<String, Value>>,
}

/// The asset root is independent of the database, CWD and build output directories.
pub fn asset_directory(executable: &Path, project: &Path, development: bool) -> Result<PathBuf> {
    if development {
        Ok(project.join(".riftmind-dev/assets"))
    } else {
        Ok(executable
            .parent()
            .ok_or_else(|| AppError::new(ErrorCode::StorageUnavailable))?
            .join("assets"))
    }
}

/// Initialize only our directory; never fall back to another location on permission errors.
pub async fn prepare_directory(root: &Path) -> Result<()> {
    tokio::fs::create_dir_all(root).await?;
    reject_link(root).await?;
    let probe = root.join(format!(".write-test-{}", uuid::Uuid::new_v4()));
    let file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .await?;
    drop(file);
    tokio::fs::remove_file(probe).await?;
    Ok(())
}

async fn reject_link(path: &Path) -> Result<()> {
    if let Ok(meta) = tokio::fs::symlink_metadata(path).await {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(AppError::new(ErrorCode::Forbidden));
            }
        }
        if meta.file_type().is_symlink() {
            return Err(AppError::new(ErrorCode::Forbidden));
        }
    }
    Ok(())
}

fn patch(version: &str) -> Result<String> {
    let parts: Vec<_> = version.split('.').collect();
    if !(2..=4).contains(&parts.len())
        || parts
            .iter()
            .any(|s| s.is_empty() || s.len() > 5 || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    Ok(format!("{}.{}", parts[0], parts[1]))
}

fn validate_path(path: &str) -> Result<&'static str> {
    let parts: Vec<_> = path.strip_prefix('/').unwrap_or("").split('/').collect();
    if path.len() > 768
        || parts.len() < 7
        || patch(parts[0])? != parts[0]
        || !path[1..].starts_with(&format!("{}/{PREFIX}", parts[0]))
        || !["default", "zh_cn"].contains(&parts[4])
        || parts.iter().any(|p| {
            p.is_empty()
                || p.starts_with('.')
                || p.ends_with('.')
                || !p
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-.".contains(&b))
                || matches!(
                    p.split('.').next().unwrap_or(""),
                    "con"
                        | "prn"
                        | "aux"
                        | "nul"
                        | "com1"
                        | "com2"
                        | "com3"
                        | "com4"
                        | "com5"
                        | "com6"
                        | "com7"
                        | "com8"
                        | "com9"
                        | "lpt1"
                        | "lpt2"
                        | "lpt3"
                        | "lpt4"
                        | "lpt5"
                        | "lpt6"
                        | "lpt7"
                        | "lpt8"
                        | "lpt9"
                )
        })
    {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    if path.ends_with(".png") {
        Ok("image/png")
    } else if path.ends_with(".json") {
        Ok("application/json")
    } else {
        Err(AppError::new(ErrorCode::InvalidInput))
    }
}

fn validate_bytes(bytes: &[u8], content_type: &str) -> Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    if content_type == "application/json" {
        serde_json::from_slice::<Value>(bytes)?;
    } else {
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        decoder.set_limits(png::Limits {
            bytes: 32 * 1024 * 1024,
        });
        let mut reader = decoder
            .read_info()
            .map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
        let size = reader
            .output_buffer_size()
            .filter(|s| *s <= 32 * 1024 * 1024)
            .ok_or_else(|| AppError::new(ErrorCode::InvalidInput))?;
        reader
            .next_frame(&mut vec![0; size])
            .map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
        reader
            .finish()
            .map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
    }
    Ok(())
}

impl ResourceClient {
    pub fn production() -> Self {
        Self::new("https://raw.communitydragon.org".into())
    }
    pub fn fixture(base: String) -> Result<Self> {
        let u = reqwest::Url::parse(&base).map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
        if u.scheme() != "http" || u.host_str() != Some("127.0.0.1") {
            return Err(AppError::new(ErrorCode::Forbidden));
        }
        Ok(Self::new(base))
    }
    fn new(base: String) -> Self {
        Self {
            base,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap(),
            gate: Semaphore::new(4),
            flights: Mutex::new(HashMap::new()),
            failures: Mutex::new(HashMap::new()),
            metadata: Mutex::new(HashMap::new()),
        }
    }

    pub async fn read(&self, root: &Path, path: &str) -> Result<ResourceFile> {
        let content_type = validate_path(path)?;
        let flight = {
            let mut flights = self.flights.lock().await;
            flights.retain(|_, v| v.strong_count() > 0);
            if let Some(lock) = flights.get(path).and_then(Weak::upgrade) {
                lock
            } else {
                let lock = Arc::new(Mutex::new(()));
                flights.insert(path.into(), Arc::downgrade(&lock));
                lock
            }
        };
        let _flight = flight.lock().await;
        reject_link(root).await?;
        let mut file = root.join("cdragon");
        reject_link(&file).await?;
        for part in path[1..].split('/') {
            file.push(part);
            reject_link(&file).await?;
        }
        match tokio::fs::metadata(&file).await {
            Ok(meta) if meta.len() <= MAX_BYTES as u64 => {
                let bytes = tokio::fs::read(&file).await?;
                if validate_bytes(&bytes, content_type).is_ok() {
                    return Ok(ResourceFile {
                        bytes,
                        content_type,
                    });
                }
                tokio::fs::remove_file(&file).await?;
            }
            Ok(_) => {
                tokio::fs::remove_file(&file).await?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        if let Some((at, code)) = self.failures.lock().await.get(path)
            && at.elapsed() < Duration::from_secs(10)
        {
            return Err(AppError::new(code.clone()));
        }
        let downloaded = self.download(path, content_type).await;
        let bytes = match downloaded {
            Ok(bytes) => bytes,
            Err(e) => {
                let mut failures = self.failures.lock().await;
                failures.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(10));
                if failures.len() >= 256 {
                    failures.clear();
                }
                failures.insert(path.into(), (Instant::now(), e.code.clone()));
                return Err(e);
            }
        };
        let parent = file.parent().unwrap();
        tokio::fs::create_dir_all(parent).await?;
        let temporary = parent.join(format!(".{}.part", uuid::Uuid::new_v4()));
        let saved: Result<()> = async {
            let mut output = tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .await?;
            output.write_all(&bytes).await?;
            output.sync_all().await?;
            drop(output);
            tokio::fs::rename(&temporary, &file).await?;
            Ok(())
        }
        .await;
        if saved.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
        }
        saved?;
        self.failures.lock().await.remove(path);
        Ok(ResourceFile {
            bytes,
            content_type,
        })
    }

    async fn download(&self, path: &str, content_type: &str) -> Result<Vec<u8>> {
        let _permit = self
            .gate
            .acquire()
            .await
            .map_err(|_| AppError::new(ErrorCode::AppNotReady))?;
        let mut response = self
            .client
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(AppError::new(match response.status().as_u16() {
                404 => ErrorCode::NotFound,
                429 => ErrorCode::RateLimited,
                _ => ErrorCode::NetworkUnavailable,
            }));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BYTES as u64)
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?
        {
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            bytes.extend(chunk);
        }
        validate_bytes(&bytes, content_type)?;
        Ok(bytes)
    }

    pub async fn reset_failures(&mut self) {
        self.failures.get_mut().clear();
        self.metadata.get_mut().clear();
    }

    pub async fn respond(&self, root: &Path, method: &str, path: &str) -> ResourceResponse {
        if method != "GET" && method != "HEAD" {
            return ResourceResponse {
                status: 405,
                content_type: "text/plain",
                body: vec![],
            };
        }
        match self.read(root, path).await {
            Ok(file) => ResourceResponse {
                status: 200,
                content_type: file.content_type,
                body: if method == "HEAD" { vec![] } else { file.bytes },
            },
            Err(e) => ResourceResponse {
                status: match e.code {
                    ErrorCode::NotFound => 404,
                    ErrorCode::InvalidInput => 400,
                    ErrorCode::Forbidden => 403,
                    ErrorCode::RateLimited => 429,
                    ErrorCode::StorageUnavailable | ErrorCode::StorageFull => 507,
                    _ => 502,
                },
                content_type: "text/plain",
                body: vec![],
            },
        }
    }

    async fn metadata(&self, root: &Path, path: &str) -> Result<Value> {
        let mut metadata = self.metadata.lock().await;
        if let Some(value) = metadata.get(path) {
            return Ok(value.clone());
        }
        let value: Value = serde_json::from_slice(&self.read(root, path).await?.bytes)?;
        if metadata.len() >= 128 {
            metadata.clear();
        }
        metadata.insert(path.into(), value.clone());
        Ok(value)
    }

    pub async fn item_catalogue(
        &self,
        root: &Path,
        query: ItemCatalogueQuery,
    ) -> Result<ItemCatalogue> {
        if !["zh-CN", "en-US"].contains(&query.locale.as_str())
            || query.version.split('.').count() != 3
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        patch(&query.version)?;
        let language = if query.locale == "zh-CN" {
            "zh_CN"
        } else {
            "en_US"
        };
        let key = format!("items-{}-{language}.json", query.version);
        let flight = {
            let mut flights = self.flights.lock().await;
            if let Some(lock) = flights.get(&key).and_then(Weak::upgrade) {
                lock
            } else {
                let lock = Arc::new(Mutex::new(()));
                flights.insert(key.clone(), Arc::downgrade(&lock));
                lock
            }
        };
        let _flight = flight.lock().await;
        let directory = root.join("catalogues");
        reject_link(root).await?;
        reject_link(&directory).await?;
        tokio::fs::create_dir_all(&directory).await?;
        let file = directory.join(&key);
        reject_link(&file).await?;
        let bytes = if let Ok(metadata) = tokio::fs::metadata(&file).await {
            if metadata.len() > MAX_BYTES as u64 {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            tokio::fs::read(&file).await?
        } else {
            let _budget = self
                .gate
                .acquire()
                .await
                .map_err(|_| AppError::new(ErrorCode::Cancelled))?;
            let url = if self.base.starts_with("http://127.0.0.1:") {
                format!(
                    "{}/catalogues/{}/{language}/item.json",
                    self.base, query.version
                )
            } else {
                format!(
                    "https://ddragon.leagueoflegends.com/cdn/{}/data/{language}/item.json",
                    query.version
                )
            };
            let mut response = self
                .client
                .get(url)
                .send()
                .await
                .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
            if !response.status().is_success() {
                return Err(AppError::new(if response.status().as_u16() == 404 {
                    ErrorCode::NotFound
                } else {
                    ErrorCode::NetworkUnavailable
                }));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?
            {
                if bytes.len() + chunk.len() > MAX_BYTES {
                    return Err(AppError::new(ErrorCode::InvalidInput));
                }
                bytes.extend(chunk);
            }
            let catalogue: Value = serde_json::from_slice(&bytes)?;
            if catalogue["version"] != query.version || catalogue["data"].as_object().is_none() {
                return Err(AppError::new(ErrorCode::DataIncomplete));
            }
            let temporary = directory.join(format!(".{}.part", uuid::Uuid::new_v4()));
            let saved: Result<()> = async {
                let mut output = tokio::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)
                    .await?;
                output.write_all(&bytes).await?;
                output.sync_all().await?;
                drop(output);
                tokio::fs::rename(&temporary, &file).await?;
                Ok(())
            }
            .await;
            if saved.is_err() {
                let _ = tokio::fs::remove_file(&temporary).await;
            }
            saved?;
            bytes
        };
        let catalogue: Value = serde_json::from_slice(&bytes)?;
        if catalogue["version"] != query.version {
            return Err(AppError::new(ErrorCode::DataIncomplete));
        }
        let rows = catalogue["data"]
            .as_object()
            .ok_or(AppError::new(ErrorCode::DataIncomplete))?;
        let items = rows
            .iter()
            .filter_map(|(id, row)| {
                Some(CatalogueItem {
                    id: id.parse().ok()?,
                    name: row["name"].as_str()?.into(),
                    maps: row["maps"]
                        .as_object()?
                        .iter()
                        .filter(|(_, enabled)| enabled.as_bool() == Some(true))
                        .filter_map(|(map, _)| map.parse().ok())
                        .collect(),
                    purchasable: row["gold"]["purchasable"].as_bool() == Some(true)
                        && row["inStore"].as_bool() != Some(false)
                        && row["hideFromAll"].as_bool() != Some(true)
                        && row["requiredChampion"].as_str().is_none_or(str::is_empty),
                })
            })
            .collect();
        Ok(ItemCatalogue {
            version: query.version,
            items,
        })
    }

    pub async fn resolve(
        &self,
        pool: &SqlitePool,
        root: &Path,
        req: AssetRequest,
    ) -> Result<Vec<Asset>> {
        let mut ids: Vec<_> = req
            .champion_ids
            .into_iter()
            .map(|id| ResourceId {
                kind: ResourceKind::Champion,
                id,
            })
            .collect();
        ids.extend(req.resource_ids.unwrap_or_default());
        if !["zh-CN", "en-US"].contains(&req.locale.as_str()) || ids.len() > 100 {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let requested_patch = patch(&req.version)?;
        let locale = if req.locale == "zh-CN" {
            "zh_cn"
        } else {
            "default"
        };
        let prefix = format!("/{requested_patch}/{PREFIX}");
        let mut result = vec![];
        for resource in ids {
            let kind = match resource.kind {
                ResourceKind::Champion => "champion",
                ResourceKind::Item => "item",
                ResourceKind::Rune => "rune",
                ResourceKind::Spell => "spell",
                ResourceKind::Skill => "skill",
            };
            // Skill IDs combine champion ID and the 1-based Q/W/E/R slot in one resource key.
            if resource.kind == ResourceKind::Skill
                && (resource.id / 10 == 0 || !(1..=4).contains(&(resource.id % 10)))
            {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            let resource_id = format!("{kind}:{}", resource.id);
            let file = match resource.kind {
                ResourceKind::Champion => format!("champions/{}", resource.id),
                ResourceKind::Item => "items".into(),
                ResourceKind::Rune => "perks".into(),
                ResourceKind::Spell => "summoner-spells".into(),
                ResourceKind::Skill => format!("champions/{}", resource.id / 10),
            };
            let mut object = None;
            for language in if locale == "default" {
                vec!["default"]
            } else {
                vec![locale, "default"]
            } {
                if let Ok(meta) = self
                    .metadata(root, &format!("{prefix}{language}/v1/{file}.json"))
                    .await
                {
                    let data = if resource.kind == ResourceKind::Skill {
                        meta.get("spells")
                            .and_then(Value::as_array)
                            .and_then(|spells| spells.get((resource.id % 10 - 1) as usize))
                            .cloned()
                    } else if let Some(array) = meta.as_array() {
                        array
                            .iter()
                            .find(|v| v["id"].as_u64() == Some(resource.id as u64))
                            .cloned()
                    } else {
                        (meta["id"].as_u64() == Some(resource.id as u64)).then_some(meta)
                    };
                    if let Some(data) = data {
                        object = Some(data);
                        break;
                    }
                }
            }
            let name = object
                .as_ref()
                .and_then(|v| v["name"].as_str())
                .map(str::to_owned);
            let path = object
                .as_ref()
                .and_then(|object| {
                    if resource.kind == ResourceKind::Champion {
                        Some(format!(
                            "{prefix}default/v1/champion-icons/{}.png",
                            resource.id
                        ))
                    } else {
                        object
                            .get(if resource.kind == ResourceKind::Skill {
                                "abilityIconPath"
                            } else {
                                "iconPath"
                            })
                            .and_then(Value::as_str)
                            .and_then(|s| s.strip_prefix("/lol-game-data/assets/"))
                            .map(|s| format!("{prefix}default/{}", s.to_ascii_lowercase()))
                    }
                })
                .filter(|p| validate_path(p).is_ok());
            let availability = if path.is_some() { "ready" } else { "missing" };
            // Retain the existing backup projection; the file tree itself is the download index.
            sqlx::query("INSERT INTO resource_manifests VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(resource_key) DO UPDATE SET path=excluded.path,hash=excluded.hash,name=excluded.name,availability=excluded.availability")
                .bind(format!("{requested_patch}:{}:{resource_id}", req.locale)).bind(&requested_patch).bind(&req.locale).bind(&resource_id)
                .bind(&path).bind(Option::<String>::None).bind(&name).bind(availability).execute(pool).await?;
            result.push(Asset {
                resource_id,
                requested_version: req.version.clone(),
                actual_version: object.map(|_| requested_patch.clone()),
                locale: req.locale.clone(),
                name,
                reference: path.map(|p| format!("{PROTOCOL_ORIGIN}{p}")),
                hash: None,
                availability: availability.into(),
            });
        }
        Ok(result)
    }
}
