use riftmind_core::{
    clients::{self, MatchRemote},
    contracts::*,
    services::{Service, build_sync::selected_build_context},
    storage,
};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
    time::Duration,
};
use tokio::sync::Mutex;

async fn open_service(root: &std::path::Path) -> Arc<Service> {
    Service::new(
        storage::open(&root.join("riftmind.db")).await.unwrap(),
        root.into(),
        Arc::new(riftmind_core::settings::JsonSettingsStore(
            root.join("settings.json"),
        )),
    )
    .await
    .unwrap()
}

struct SelectionRemote {
    live: Mutex<Value>,
    collection: Mutex<Value>,
    writes: AtomicU32,
    identity: Mutex<String>,
    reads: AtomicU32,
    swap_on_read: AtomicU32,
}
#[async_trait::async_trait]
impl MatchRemote for SelectionRemote {
    fn supports_item_sets(&self) -> bool {
        true
    }
    async fn page(&self, _: &Player, _: u32, _: Source) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    async fn current_match(&self) -> Result<Value> {
        Ok(self.live.lock().await.clone())
    }
    async fn item_set_identity(&self) -> Result<Value> {
        Ok(json!({"summonerId":123,"puuid":*self.identity.lock().await}))
    }
    async fn item_sets(&self, _: u64) -> Result<Value> {
        let reads = self.reads.fetch_add(1, Ordering::SeqCst) + 1;
        if self.swap_on_read.load(Ordering::SeqCst) == reads {
            self.live.lock().await["champSelect"]["myTeam"][0]["championId"] = 103.into();
        }
        Ok(self.collection.lock().await.clone())
    }
    async fn put_item_sets(&self, _: u64, collection: Value) -> Result<()> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        *self.collection.lock().await = collection;
        Ok(())
    }
}
fn selected(champion_id: u32, map_id: u32) -> Value {
    json!({"phase":"ChampSelect","game":{"map":{"id":map_id},"gameData":{"queue":{"id":420,"mapId":map_id}}},"champSelect":{"localPlayerCellId":0,"myTeam":[{"cellId":0,"championId":champion_id,"puuid":"synthetic-player"}],"theirTeam":[]}})
}
async fn workspace() -> (tempfile::TempDir, Arc<Service>, Arc<SelectionRemote>) {
    let test_directory =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tmp/champion-build-tests");
    std::fs::create_dir_all(&test_directory).unwrap();
    let root = tempfile::Builder::new()
        .prefix("workspace-")
        .tempdir_in(test_directory)
        .unwrap();
    let service = open_service(root.path()).await;
    let catalogue = service
        .asset_root
        .join("catalogues/items-16.20.1-en_US.json");
    tokio::fs::create_dir_all(catalogue.parent().unwrap())
        .await
        .unwrap();
    tokio::fs::write(catalogue, serde_json::to_vec(&json!({"type":"item","version":"16.20.1","data":{"1001":{"name":"Boots","gold":{"purchasable":true},"maps":{"11":true,"12":true}}}})).unwrap()).await.unwrap();
    let remote = Arc::new(SelectionRemote {
        live: Mutex::new(selected(64, 11)),
        collection: Mutex::new(
            json!({"itemSets":[{"uid":"existing","custom":"keep"}],"timestamp":123}),
        ),
        writes: AtomicU32::new(0),
        identity: Mutex::new("synthetic-player".into()),
        reads: AtomicU32::new(0),
        swap_on_read: AtomicU32::new(0),
    });
    service
        .set_connection(
            ConnectionState {
                phase: ConnectionPhase::Connected,
                player: Some(clients::synthetic_player("TENCENT_HN1")),
                lcu_ready: true,
                ..ConnectionState::default()
            },
            Some(remote.clone()),
        )
        .await
        .unwrap();
    (root, service, remote)
}
async fn plan(service: &Service, champion_id: u32, map_id: u32) -> NotebookEntry {
    let content: NotebookContent = serde_json::from_value(json!({"championId":champion_id,"kind":"build","title":"My jungle plan","text":"Private notes","pinned":false,"opponentId":null,"position":null,"tags":[],"steps":[],"groups":[{"name":"Start","items":[{"id":1001,"count":1}]}],"mapId":map_id,"resourceVersion":"16.20.1","confirmedPatch":null,"links":[],"sources":[],"skillOrder":[1,2,3,1,1,4,1,2,1,2,4,2,2,3,3,4,3,3]})).unwrap();
    service
        .save_notebook(SaveNotebook {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            id: None,
            expected_revision: 0,
            content,
            confirm_patch: None,
        })
        .await
        .unwrap()
}
async fn enable(
    service: &Service,
    entry: &NotebookEntry,
    revision: u32,
    enabled: bool,
) -> BuildSyncRule {
    service
        .save_build_sync_rule(SaveBuildSyncRule {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            entry_id: entry.id.clone(),
            expected_revision: revision,
            enabled,
        })
        .await
        .unwrap()
}
async fn synchronize(service: &Service, remote: &SelectionRemote) {
    let snapshot = LiveSnapshot {
        phase: "ChampSelect".into(),
        stale: false,
        session_epoch: service.connection.read().await.session_epoch.clone(),
        generation: "selected-game".into(),
        ..LiveSnapshot::default()
    };
    let raw = remote.live.lock().await.clone();
    service.sync_champion_build(&snapshot, &raw).await.unwrap();
}
async fn rules(service: &Service) -> Vec<BuildSyncRule> {
    service
        .build_sync_rules(BuildSyncQuery { champion_id: None })
        .await
        .unwrap()
}

#[tokio::test]
async fn selection_sync_is_opt_in_idempotent_and_persists_skills_without_exporting_them_to_item_sets()
 {
    let (_root, service, remote) = workspace().await;
    let entry = plan(&service, 64, 11).await;
    synchronize(&service, &remote).await;
    assert_eq!(remote.writes.load(Ordering::SeqCst), 0);
    enable(&service, &entry, 0, true).await;
    synchronize(&service, &remote).await;
    synchronize(&service, &remote).await;
    assert_eq!(remote.writes.load(Ordering::SeqCst), 1);
    assert_eq!(rules(&service).await[0].state, "applied");
    let collection = remote.collection.lock().await.clone();
    assert_eq!(collection["itemSets"][0]["custom"], "keep");
    assert!(!collection.to_string().contains("skillOrder"));
    assert!(!collection.to_string().contains("Private notes"));
    let exported = service
        .export_notebook(NotebookQuery {
            champion_id: Some(64),
            kind: None,
            search: String::new(),
            opponent_id: None,
            trash: false,
        })
        .await
        .unwrap();
    assert_eq!(
        exported.entries[0]
            .content
            .skill_order
            .as_ref()
            .unwrap()
            .len(),
        18
    );
    enable(&service, &entry, 1, false).await;
    synchronize(&service, &remote).await;
    assert_eq!(remote.writes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn wrong_champion_map_account_and_selection_changes_never_write() {
    let (_root, service, remote) = workspace().await;
    let entry = plan(&service, 64, 11).await;
    enable(&service, &entry, 0, true).await;
    *remote.live.lock().await = selected(103, 11);
    synchronize(&service, &remote).await;
    *remote.live.lock().await = selected(64, 12);
    synchronize(&service, &remote).await;
    assert_eq!(remote.writes.load(Ordering::SeqCst), 0);
    *remote.live.lock().await = selected(64, 11);
    *remote.identity.lock().await = "another-account".into();
    synchronize(&service, &remote).await;
    assert_eq!(
        rules(&service).await[0].error,
        Some(ErrorCode::SessionChanged)
    );
    assert_eq!(remote.writes.load(Ordering::SeqCst), 0);
    *remote.identity.lock().await = "synthetic-player".into();
    enable(&service, &entry, 1, true).await;
    remote.swap_on_read.store(2, Ordering::SeqCst);
    synchronize(&service, &remote).await;
    assert_eq!(remote.writes.load(Ordering::SeqCst), 0);
    assert_eq!(
        rules(&service).await[0].error,
        Some(ErrorCode::SessionChanged)
    );
    assert!(selected_build_context(&json!({"phase":"ChampSelect","champSelect":{"localPlayerCellId":0,"myTeam":[{"cellId":0,"championId":64}]}})).is_none());
}

#[tokio::test]
async fn live_refresh_triggers_sync_and_trashing_or_restoring_a_backup_disables_rules() {
    let (root, service, remote) = workspace().await;
    let entry = plan(&service, 64, 11).await;
    enable(&service, &entry, 0, true).await;
    service.refresh_live().await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if remote.writes.load(Ordering::SeqCst) == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let backup = service.backup().await.unwrap();
    service
        .change_notebook(ChangeNotebook {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            id: entry.id.clone(),
            expected_revision: entry.revision,
            action: "trash".into(),
            restore_revision: None,
            confirm_permanent: false,
        })
        .await
        .unwrap();
    assert!(!rules(&service).await[0].enabled);
    service.restore(&backup.reference).await.unwrap();
    assert!(!rules(&service).await[0].enabled);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("PRAGMA user_version")
            .fetch_one(&service.pool)
            .await
            .unwrap(),
        i64::from(storage::DATABASE_VERSION)
    );
    service.pool.close().await;
    drop(service);
    let reopened = open_service(root.path()).await;
    assert!(!rules(&reopened).await[0].enabled);
}

#[tokio::test]
async fn rule_changes_require_current_revision_and_skill_orders_reject_invalid_slots() {
    let (_root, service, _remote) = workspace().await;
    let entry = plan(&service, 64, 11).await;
    enable(&service, &entry, 0, true).await;
    let error = service
        .save_build_sync_rule(SaveBuildSyncRule {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            entry_id: entry.id.clone(),
            expected_revision: 0,
            enabled: false,
        })
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::RevisionConflict);
    let mut invalid = entry.content.clone();
    invalid.skill_order = Some(vec![5]);
    assert!(riftmind_core::services::notebooks::validate_content(&invalid).is_err());
    invalid.skill_order = Some(vec![1; 19]);
    assert!(riftmind_core::services::notebooks::validate_content(&invalid).is_err());
    let mut legacy = serde_json::to_value(&entry.content).unwrap();
    legacy.as_object_mut().unwrap().remove("skillOrder");
    assert!(
        serde_json::from_value::<NotebookContent>(legacy)
            .unwrap()
            .skill_order
            .is_none()
    );
}

#[tokio::test]
async fn lcu_http_adapter_validates_authentication_identity_and_item_set_readback() {
    use axum::{
        Json, Router,
        extract::{Request, State},
        http::StatusCode,
        routing::any,
    };
    use riftmind_core::clients::{HttpRemote, LcuClient, Tokens};
    let (_root, service, remote) = workspace().await;
    let entry = plan(&service, 64, 11).await;
    let routes = Router::new()
        .fallback(any(
            |State(remote): State<Arc<SelectionRemote>>, request: Request| async move {
                if request
                    .headers()
                    .get("authorization")
                    .and_then(|header| header.to_str().ok())
                    != Some("Basic cmlvdDpzeW50aGV0aWMtbGN1")
                {
                    return (StatusCode::UNAUTHORIZED, Json(json!({})));
                }
                let path = request.uri().path().to_owned();
                let method = request.method().clone();
                let value = match (method.as_str(), path.as_str()) {
                    ("GET", "/lol-gameflow/v1/gameflow-phase") => json!("ChampSelect"),
                    ("GET", "/lol-gameflow/v1/session") => remote.live.lock().await["game"].clone(),
                    ("GET", "/lol-champ-select/v1/session") => {
                        remote.live.lock().await["champSelect"].clone()
                    }
                    ("GET", "/lol-summoner/v1/current-summoner") => {
                        remote.item_set_identity().await.unwrap()
                    }
                    ("GET", "/lol-item-sets/v1/item-sets/123/sets") => {
                        remote.item_sets(123).await.unwrap()
                    }
                    ("PUT", "/lol-item-sets/v1/item-sets/123/sets") => {
                        let body = axum::body::to_bytes(request.into_body(), 1024 * 1024)
                            .await
                            .unwrap();
                        remote
                            .put_item_sets(123, serde_json::from_slice(&body).unwrap())
                            .await
                            .unwrap();
                        json!({})
                    }
                    _ => return (StatusCode::NOT_FOUND, Json(json!({}))),
                };
                (StatusCode::OK, Json(value))
            },
        ))
        .with_state(remote.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        axum::serve(listener, routes).await.unwrap();
    });
    let server_mapping = riftmind_core::domain::servers()
        .into_iter()
        .find(|server| server.id == "TENCENT_HN1")
        .unwrap();
    let client = Arc::new(HttpRemote::new(
        Some(LcuClient::for_test(port).unwrap()),
        server_mapping,
        Tokens::default(),
    ));
    assert!(client.supports_item_sets());
    *service.remote.write().await = Some(client);
    service.connection.write().await.phase = ConnectionPhase::WaitingAuth;
    let outcome = service
        .apply_build(BuildApplyQuery {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            entry_id: entry.id,
            expected_revision: 1,
            target_version: "16.20.1".into(),
            map_id: 11,
            save_as_new: false,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    assert_eq!(outcome.state, "applied");
    assert_eq!(remote.writes.load(Ordering::SeqCst), 1);
    server.abort();
}

#[tokio::test]
async fn one_default_per_champion_and_map_is_replaced_explicitly_and_map_edits_disable_old_rules() {
    let (_root, service, remote) = workspace().await;
    let first = plan(&service, 64, 11).await;
    let replacement = plan(&service, 64, 11).await;
    let abyss = plan(&service, 64, 12).await;
    enable(&service, &first, 0, true).await;
    enable(&service, &replacement, 1, true).await;
    enable(&service, &abyss, 0, true).await;
    let configured = rules(&service).await;
    assert_eq!(configured.len(), 2);
    assert_eq!(configured[0].entry_id, replacement.id);
    synchronize(&service, &remote).await;
    *remote.live.lock().await = selected(64, 12);
    synchronize(&service, &remote).await;
    assert_eq!(remote.writes.load(Ordering::SeqCst), 2);
    let mut revised = replacement.content.clone();
    revised.map_id = Some(12);
    service
        .save_notebook(SaveNotebook {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            id: Some(replacement.id),
            expected_revision: replacement.revision,
            content: revised,
            confirm_patch: None,
        })
        .await
        .unwrap();
    let configured = rules(&service).await;
    assert!(!configured[0].enabled);
    assert!(configured[1].enabled);
}
