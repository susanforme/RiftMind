use axum::{
    Router,
    extract::{OriginalUri, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
};
use riftmind_core::{
    contracts::*,
    services::{
        Service,
        resources::{self, ResourceClient},
    },
    settings::JsonSettingsStore,
    storage,
};
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

const ICON: &str = "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/103.png";
const META: &str = "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/champions/103.json";
const PNG: &[u8] = include_bytes!("../../../tests/fixtures/icon.png");
#[derive(Default)]
struct Upstream {
    calls: AtomicUsize,
    mode: AtomicUsize,
}
async fn server() -> (String, Arc<Upstream>, tokio::task::JoinHandle<()>) {
    let state = Arc::new(Upstream::default());
    let app = Router::new().fallback(get(|State(state): State<Arc<Upstream>>, uri: OriginalUri, headers: HeaderMap| async move {
        assert!(!headers.contains_key("authorization"));
        assert!(!headers.contains_key("if-none-match"));
        assert!(!headers.contains_key("if-modified-since"));
        state.calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        match state.mode.load(Ordering::SeqCst) {
            1 => return StatusCode::NOT_FOUND.into_response(),
            2 => return ([("content-type", "image/png")], &PNG[..PNG.len() - 12]).into_response(),
            3 => return ([("content-type", "application/json")], "{broken").into_response(),
            4 => return (StatusCode::FOUND, [("location", "https://example.com/steal")]).into_response(),
            5 => return vec![0_u8; 8 * 1024 * 1024 + 1].into_response(),
            _ => {}
        }
        if uri.path().contains("/zh_cn/") { return StatusCode::NOT_FOUND.into_response(); }
        if uri.path().ends_with("items.json") {
            return axum::Json(serde_json::json!([{"id":3089,"name":"Hat","iconPath":"/lol-game-data/assets/ASSETS/Items/Hat.png"}])).into_response();
        }
        if uri.path().ends_with(".json") { return axum::Json(serde_json::json!({"id":103,"name":"Ahri","spells":[{"name":"Orb of Deception","abilityIconPath":"/lol-game-data/assets/ASSETS/Abilities/AhriQ.png"}]})).into_response(); }
        ([("content-type", "image/png")], PNG).into_response()
    })).with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    (
        base,
        state,
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() }),
    )
}

#[tokio::test]
async fn concurrent_first_requests_download_once_then_restart_works_offline_forever() {
    let (base, upstream, server) = server().await;
    let root = tempfile::tempdir().unwrap();
    let client = Arc::new(ResourceClient::fixture(base.clone()).unwrap());
    let mut tasks = vec![];
    for _ in 0..16 {
        let client = client.clone();
        let root = root.path().to_owned();
        tasks.push(tokio::spawn(async move {
            client.read(&root, ICON).await.unwrap().bytes
        }));
    }
    for task in tasks {
        assert_eq!(task.await.unwrap(), PNG);
    }
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        client.read(root.path(), META).await.unwrap().content_type,
        "application/json"
    );
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 2);
    assert_eq!(
        tokio::fs::read(root.path().join("cdragon").join(&ICON[1..]))
            .await
            .unwrap(),
        PNG
    );
    server.abort();
    drop(client);
    let restarted = ResourceClient::fixture(base).unwrap();
    for _ in 0..3 {
        assert_eq!(restarted.read(root.path(), ICON).await.unwrap().bytes, PNG);
    }
    assert!(restarted.read(root.path(), META).await.is_ok());
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn errors_invalid_content_redirects_and_partial_files_are_never_installed() {
    let (base, upstream, server) = server().await;
    let root = tempfile::tempdir().unwrap();
    for mode in 1..=5 {
        upstream.mode.store(mode, Ordering::SeqCst);
        let client = ResourceClient::fixture(base.clone()).unwrap();
        let path = if mode == 3 { META } else { ICON };
        assert!(client.read(root.path(), path).await.is_err());
        assert!(client.read(root.path(), path).await.is_err());
        assert_eq!(
            upstream.calls.load(Ordering::SeqCst),
            mode,
            "failed requests must also be coalesced/cooled down"
        );
        assert!(!root.path().join("cdragon").join(&path[1..]).exists());
    }
    upstream.mode.store(0, Ordering::SeqCst);
    let client = ResourceClient::fixture(base).unwrap();
    // An interrupted write is never considered a completed download.
    let target = root.path().join("cdragon").join(&ICON[1..]);
    tokio::fs::create_dir_all(target.parent().unwrap())
        .await
        .unwrap();
    tokio::fs::write(target.with_extension("part"), b"incomplete")
        .await
        .unwrap();
    assert_eq!(client.read(root.path(), ICON).await.unwrap().bytes, PNG);
    // Corruption on disk can be repaired; it is not time-based expiration.
    tokio::fs::write(&target, b"broken").await.unwrap();
    assert_eq!(client.read(root.path(), ICON).await.unwrap().bytes, PNG);
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 7);
    server.abort();
}

#[tokio::test]
async fn versions_and_asset_kinds_are_isolated_and_unsafe_paths_never_reach_upstream() {
    let (base, upstream, server) = server().await;
    let client = ResourceClient::fixture(base).unwrap();
    let root = tempfile::tempdir().unwrap();
    for path in [
        "",
        "/",
        "//example.com/a.png",
        "/latest/plugins/a.png",
        "/16.20/../../private.png",
        "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/../private.png",
        "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/%2e%2e/a.png",
        "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/nul.png",
        "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/a.png?url=https://example.com",
        "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/a.png:stream",
        "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/a.svg",
    ] {
        assert_eq!(
            client.respond(root.path(), "GET", path).await.status,
            400,
            "{path}"
        );
    }
    assert_eq!(client.respond(root.path(), "POST", ICON).await.status, 405);
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 0);
    assert_eq!(client.respond(root.path(), "GET", ICON).await.status, 200);
    assert_eq!(
        client
            .respond(root.path(), "GET", &ICON.replace("16.20", "16.19"))
            .await
            .status,
        200
    );
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 2);
    let head = client.respond(root.path(), "HEAD", ICON).await;
    assert!(head.body.is_empty());
    assert_eq!(head.content_type, "image/png");
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 2);
    server.abort();
}

#[tokio::test]
async fn metadata_is_persisted_and_images_are_only_fetched_by_the_protocol() {
    let (base, upstream, server) = server().await;
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    tokio::fs::create_dir_all(&workspace).await.unwrap();
    let assets = root.path().join("independent-assets");
    let service = Service::new_with_assets(
        storage::open(&workspace.join("riftmind.db")).await.unwrap(),
        workspace.clone(),
        assets.clone(),
        Arc::new(JsonSettingsStore(workspace.join("settings.json"))),
    )
    .await
    .unwrap();
    *service.resources.write().await = ResourceClient::fixture(base.clone()).unwrap();
    let req = AssetRequest {
        version: "16.20.1".into(),
        locale: "zh-CN".into(),
        champion_ids: vec![103],
        resource_ids: Some(vec![ResourceId {
            kind: ResourceKind::Item,
            id: 3089,
        }]),
    };
    let value = service
        .dispatch(Command::resolve_assets(req.clone()))
        .await
        .unwrap();
    assert_eq!(value[0]["name"], "Ahri");
    assert_eq!(value[1]["name"], "Hat");
    let reference = value[0]["reference"].as_str().unwrap();
    assert_eq!(reference, format!("http://cdragon.localhost{ICON}"));
    assert!(
        value[1]["reference"]
            .as_str()
            .unwrap()
            .ends_with("/assets/items/hat.png")
    );
    assert!(
        !assets.join("cdragon").join(&ICON[1..]).exists(),
        "resolve must not download images or send base64 over IPC"
    );
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 4);
    assert_eq!(
        service
            .resources
            .read()
            .await
            .respond(&assets, "GET", ICON)
            .await
            .status,
        200
    );
    assert!(
        !workspace.join("assets").exists(),
        "resource files must not enter the database directory"
    );
    let usage = service.usage().await;
    assert!(usage.asset_bytes > PNG.len() as f64);
    server.abort();
    *service.resources.write().await = ResourceClient::fixture(base).unwrap();
    let value = service
        .dispatch(Command::resolve_assets(req))
        .await
        .unwrap();
    assert_eq!(value[0]["name"], "Ahri");
    assert_eq!(value[1]["name"], "Hat");
    assert_eq!(
        service
            .resources
            .read()
            .await
            .respond(&assets, "GET", ICON)
            .await
            .status,
        200
    );
    service
        .dispatch(Command::clear_asset_cache(Empty {}))
        .await
        .unwrap();
    assert_eq!(service.usage().await.asset_bytes, 0.);
    assert!(workspace.join("riftmind.db").exists());
}

#[test]
fn development_and_production_paths_are_independent_of_cwd_and_build_outputs() {
    let exe = Path::new("/installed/RiftMind/riftmind.exe");
    let project = Path::new("/source/RiftMind");
    assert_eq!(
        resources::asset_directory(exe, project, false).unwrap(),
        Path::new("/installed/RiftMind/assets")
    );
    assert_eq!(
        resources::asset_directory(exe, project, true).unwrap(),
        Path::new("/source/RiftMind/.riftmind-dev/assets")
    );
}

#[tokio::test]
async fn directory_initialization_leaves_an_empty_dedicated_directory_and_preserves_siblings() {
    let root = tempfile::tempdir().unwrap();
    let assets = root.path().join("assets");
    tokio::fs::write(root.path().join("settings.json"), "keep")
        .await
        .unwrap();
    resources::prepare_directory(&assets).await.unwrap();
    assert!(
        tokio::fs::read_dir(&assets)
            .await
            .unwrap()
            .next_entry()
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        tokio::fs::read_to_string(root.path().join("settings.json"))
            .await
            .unwrap(),
        "keep"
    );
    let blocked = root.path().join("blocked");
    tokio::fs::write(&blocked, "file").await.unwrap();
    assert!(resources::prepare_directory(&blocked).await.is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn symlinked_cache_paths_are_rejected_without_writing_outside_the_asset_root() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("cdragon")).unwrap();
    let client = ResourceClient::production();
    assert_eq!(client.respond(root.path(), "GET", ICON).await.status, 403);
    assert!(
        tokio::fs::read_dir(outside.path())
            .await
            .unwrap()
            .next_entry()
            .await
            .unwrap()
            .is_none()
    );
}
#[tokio::test]
async fn champion_skill_art_resolves_by_champion_and_slot_with_typed_boundaries() {
    let (base, _, upstream) = server().await;
    let root = tempfile::tempdir().unwrap();
    let service = Service::new(
        storage::open(&root.path().join("riftmind.db"))
            .await
            .unwrap(),
        root.path().into(),
        Arc::new(JsonSettingsStore(root.path().join("settings.json"))),
    )
    .await
    .unwrap();
    *service.resources.write().await = ResourceClient::fixture(base).unwrap();
    let request = |id| AssetRequest {
        version: "16.20.1".into(),
        locale: "en-US".into(),
        champion_ids: vec![],
        resource_ids: Some(vec![ResourceId {
            kind: ResourceKind::Skill,
            id,
        }]),
    };
    let asset = service
        .dispatch(Command::resolve_assets(request(1031)))
        .await
        .unwrap();
    assert_eq!(asset[0]["resourceId"], "skill:1031");
    assert_eq!(asset[0]["name"], "Orb of Deception");
    assert!(
        asset[0]["reference"]
            .as_str()
            .unwrap()
            .ends_with("/assets/abilities/ahriq.png")
    );
    assert_eq!(
        service
            .dispatch(Command::resolve_assets(request(1035)))
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    upstream.abort();
}
