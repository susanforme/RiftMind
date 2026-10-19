use axum::{
    Router,
    extract::{OriginalUri, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
};
use base64::Engine;
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
// A generated one-pixel image keeps JPEG validation independent of upstream art.
const JPEG_BASE64: &str = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAA//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AI2AYT//2Q==";
fn jpeg_fixture() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(JPEG_BASE64)
        .unwrap()
}
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
            6 => return vec![0xff_u8, 0xd8, 0xff, 0xd9].into_response(),
            7 | 8 => {
                let mut image = jpeg_fixture();
                let frame = image.windows(2).position(|bytes| bytes == [0xff, 0xc0]).unwrap();
                let dimension = if state.mode.load(Ordering::SeqCst) == 7 { 0xffff_u16 } else { 4096_u16 };
                image[frame + 5..frame + 7].copy_from_slice(&dimension.to_be_bytes());
                image[frame + 7..frame + 9].copy_from_slice(&dimension.to_be_bytes());
                return image.into_response();
            },
            _ => {}
        }
        if uri.path().contains("/zh_cn/") { return StatusCode::NOT_FOUND.into_response(); }
        if uri.path().ends_with("items.json") {
            return axum::Json(serde_json::json!([{"id":3089,"name":"Hat","iconPath":"/lol-game-data/assets/ASSETS/Items/Hat.png"}])).into_response();
        }
        if uri.path().ends_with("perkstyles.json") {
            return axum::Json(serde_json::json!({"styles":[{"id":8200,"name":"Sorcery","iconPath":"/lol-game-data/assets/v1/perk-images/styles/7202_sorcery.png"}]})).into_response();
        }
        if uri.path().ends_with("perks.json") {
            return axum::Json(serde_json::json!([{"id":8112,"name":"Electrocute","iconPath":"/lol-game-data/assets/v1/perk-images/styles/domination/electrocute/electrocute.png"}])).into_response();
        }
        if uri.path().ends_with("profile-icons.json") {
            return axum::Json(serde_json::json!([
                {"id":0,"iconPath":"/lol-game-data/assets/v1/profile-icons/0.jpg"},
                {"id":1,"iconPath":"https://example.com/external.jpg"}
            ])).into_response();
        }
        if uri.path().ends_with(".json") { return axum::Json(serde_json::json!({"id":103,"name":"Ahri","spells":[{"name":"Orb of Deception","abilityIconPath":"/lol-game-data/assets/ASSETS/Abilities/AhriQ.png"}],"skins":[
            {"id":103000,"name":"Ahri","isBase":true,"uncenteredSplashPath":"/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Base/Images/ahri_splash_uncentered_0.jpg"},
            {"id":103001,"name":"Dynasty Ahri","isBase":false,"splashPath":"/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Skin01/Images/ahri_splash_centered_1.jpg"},
            {"id":103999,"name":"Unsafe path","isBase":false,"splashPath":"/lol-game-data/assets/../outside.jpg"}
        ]})).into_response(); }
        if uri.path().ends_with(".jpg") { return ([("content-type", "image/jpeg")], jpeg_fixture()).into_response(); }
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
async fn keystones_and_secondary_rune_styles_resolve_from_their_respective_catalogues() {
    let (base, _, upstream) = server().await;
    let root =
        tempfile::tempdir_in(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tmp")).unwrap();
    let pool = storage::open(&root.path().join("riftmind.db"))
        .await
        .unwrap();
    let client = ResourceClient::fixture(base).unwrap();
    let assets = client
        .resolve(
            &pool,
            root.path(),
            AssetRequest {
                version: "16.20.1".into(),
                locale: "zh-CN".into(),
                champion_ids: vec![],
                resource_ids: Some(vec![
                    ResourceId {
                        kind: ResourceKind::Rune,
                        id: 8112,
                    },
                    ResourceId {
                        kind: ResourceKind::Rune,
                        id: 8200,
                    },
                ]),
            },
        )
        .await
        .unwrap();
    assert_eq!(assets[0].name.as_deref(), Some("Electrocute"));
    assert_eq!(assets[1].name.as_deref(), Some("Sorcery"));
    for asset in assets {
        let path = asset.reference.unwrap();
        let path = path.strip_prefix(resources::PROTOCOL_ORIGIN).unwrap();
        assert_eq!(client.respond(root.path(), "GET", path).await.status, 200);
    }
    upstream.abort();
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

#[tokio::test]
async fn profile_icons_and_skin_splashes_resolve_real_metadata_and_stay_available_offline() {
    let (base, upstream, server) = server().await;
    let root =
        tempfile::tempdir_in(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tmp")).unwrap();
    let pool = storage::open(&root.path().join("riftmind.db"))
        .await
        .unwrap();
    let client = ResourceClient::fixture(base.clone()).unwrap();
    let catalogue_query = ChampionSkinsQuery {
        champion_id: 103,
        version: "16.20.1".into(),
        locale: "zh-CN".into(),
    };
    let catalogue = client
        .champion_skins(root.path(), catalogue_query.clone())
        .await
        .unwrap();
    assert_eq!(catalogue.champion_id, 103);
    assert_eq!(catalogue.skins[0].id, 103000);
    assert!(catalogue.skins[0].is_base);
    assert_eq!(catalogue.skins[1].name, "Dynasty Ahri");
    let request = AssetRequest {
        version: "16.20.1".into(),
        locale: "zh-CN".into(),
        champion_ids: vec![],
        resource_ids: Some(vec![
            ResourceId {
                kind: ResourceKind::ProfileIcon,
                id: 0,
            },
            ResourceId {
                kind: ResourceKind::ChampionSplash,
                id: 103000,
            },
            ResourceId {
                kind: ResourceKind::ChampionSplash,
                id: 103001,
            },
            ResourceId {
                kind: ResourceKind::ChampionSplash,
                id: 103999,
            },
            ResourceId {
                kind: ResourceKind::ProfileIcon,
                id: 1,
            },
            ResourceId {
                kind: ResourceKind::ChampionSplash,
                id: 103777,
            },
        ]),
    };
    let assets = client
        .resolve(&pool, root.path(), request.clone())
        .await
        .unwrap();
    assert_eq!(assets[0].resource_id, "profile_icon:0");
    assert!(
        assets[0]
            .reference
            .as_ref()
            .unwrap()
            .ends_with("/v1/profile-icons/0.jpg")
    );
    assert!(
        assets[1]
            .reference
            .as_ref()
            .unwrap()
            .ends_with("/assets/characters/ahri/skins/base/images/ahri_splash_uncentered_0.jpg")
    );
    assert!(
        assets[2]
            .reference
            .as_ref()
            .unwrap()
            .ends_with("/assets/characters/ahri/skins/skin01/images/ahri_splash_centered_1.jpg")
    );
    for unavailable in &assets[3..] {
        assert_eq!(unavailable.availability, "missing");
        assert!(unavailable.reference.is_none());
    }
    for asset in &assets[..3] {
        let path = asset
            .reference
            .as_ref()
            .unwrap()
            .strip_prefix(resources::PROTOCOL_ORIGIN)
            .unwrap();
        let response = client.respond(root.path(), "GET", path).await;
        assert_eq!(response.status, 200);
        assert_eq!(response.content_type, "image/jpeg");
        assert_eq!(response.body, jpeg_fixture());
    }
    let calls = upstream.calls.load(Ordering::SeqCst);
    server.abort();
    let restarted = ResourceClient::fixture(base).unwrap();
    assert_eq!(
        restarted
            .champion_skins(root.path(), catalogue_query)
            .await
            .unwrap()
            .skins
            .len(),
        catalogue.skins.len()
    );
    let cached = restarted
        .resolve(&pool, root.path(), request)
        .await
        .unwrap();
    for asset in &cached[..3] {
        let path = asset
            .reference
            .as_ref()
            .unwrap()
            .strip_prefix(resources::PROTOCOL_ORIGIN)
            .unwrap();
        assert_eq!(
            restarted.respond(root.path(), "GET", path).await.status,
            200
        );
    }
    assert_eq!(upstream.calls.load(Ordering::SeqCst), calls);
}

#[tokio::test]
async fn jpeg_validation_rejects_malformed_pixels_oversized_dimensions_and_unsafe_catalogue_queries()
 {
    let (base, upstream, server) = server().await;
    let root =
        tempfile::tempdir_in(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tmp")).unwrap();
    let path = "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/0.jpg";
    for mode in [6, 7, 8] {
        upstream.mode.store(mode, Ordering::SeqCst);
        let client = ResourceClient::fixture(base.clone()).unwrap();
        assert!(
            matches!(client.read(root.path(), path).await, Err(error) if error.code == ErrorCode::InvalidInput)
        );
        assert!(!root.path().join("cdragon").join(&path[1..]).exists());
    }
    let calls = upstream.calls.load(Ordering::SeqCst);
    let client = ResourceClient::fixture(base).unwrap();
    for (champion_id, version, locale) in [
        (0, "16.20.1", "en-US"),
        (103, "../../private", "en-US"),
        (103, "16.20.1", "invalid"),
    ] {
        let error = client
            .champion_skins(
                root.path(),
                ChampionSkinsQuery {
                    champion_id,
                    version: version.into(),
                    locale: locale.into(),
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidInput);
    }
    assert_eq!(upstream.calls.load(Ordering::SeqCst), calls);
    server.abort();
}
