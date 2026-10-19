use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, OriginalUri, Path as AxumPath, Query, State, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use riftmind_core::{
    clients::{self, HttpRemote},
    contracts::*,
    domain,
    services::Service,
    settings::JsonSettingsStore,
    storage,
};
use serde_json::{Value, json};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::Mutex;
#[derive(Clone)]
struct Bridge {
    service: Arc<Service>,
    token: String,
    origin: String,
    mock_base: String,
    scenario: Arc<Mutex<Scenario>>,
}
#[derive(Default)]
struct Scenario {
    status: u16,
    delay: u64,
    calls: u32,
    asset_calls: u32,
    assets_offline: bool,
    generation: u32,
}
fn allowed(headers: &HeaderMap, b: &Bridge) -> bool {
    headers
        .get("origin")
        .and_then(|h| h.to_str().ok())
        .is_none_or(|o| o == b.origin)
        && headers
            .get("x-riftmind-token")
            .and_then(|h| h.to_str().ok())
            == Some(&b.token)
}
async fn command(
    State(b): State<Bridge>,
    headers: HeaderMap,
    Json(cmd): Json<Command>,
) -> impl IntoResponse {
    if !allowed(&headers, &b) {
        return (StatusCode::FORBIDDEN, Json(json!({"error":"forbidden"})));
    }
    let result = b.service.dispatch(cmd).await;
    match result {
        Ok(v) => (StatusCode::OK, Json(json!({"ok":v}))),
        Err(e) => (StatusCode::OK, Json(json!({"error":e}))),
    }
}
async fn events(
    State(b): State<Bridge>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> axum::response::Response {
    if headers.get("origin").and_then(|h| h.to_str().ok()) != Some(&b.origin)
        || q.get("token") != Some(&b.token)
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut rx = b.service.events.subscribe();
    ws.on_upgrade(move |mut socket| async move {
        while let Ok(ev) = rx.recv().await {
            if socket
                .send(axum::extract::ws::Message::Text(
                    serde_json::to_string(&ev).unwrap().into(),
                ))
                .await
                .is_err()
            {
                break;
            }
        }
    })
}
async fn resource(
    State(b): State<Bridge>,
    uri: OriginalUri,
    headers: HeaderMap,
) -> axum::response::Response {
    if headers
        .get("origin")
        .is_some_and(|v| v.to_str().ok() != Some(&b.origin))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let path = uri
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/")
        .strip_prefix("/resources")
        .unwrap_or("/");
    let response = b
        .service
        .resources
        .read()
        .await
        .respond(&b.service.asset_root, "GET", path)
        .await;
    (
        StatusCode::from_u16(response.status).unwrap(),
        [
            ("content-type", response.content_type),
            ("cache-control", "no-store"),
            ("x-content-type-options", "nosniff"),
        ],
        response.body,
    )
        .into_response()
}
fn chrono_time_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
async fn mock_resource(
    State(b): State<Bridge>,
    uri: OriginalUri,
    headers: HeaderMap,
) -> axum::response::Response {
    assert!(!headers.contains_key("authorization"));
    if !uri.path().starts_with("/16.20/plugins/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    {
        let mut state = b.scenario.lock().await;
        state.asset_calls += 1;
        if state.assets_offline {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }
    let zh = uri.path().contains("/zh_cn/");
    if uri.path().ends_with("items.json") {
        return Json(json!([
            {"id":3089,"name":if zh {"灭世者的死亡之帽"} else {"Rabadon's Deathcap"},"iconPath":"/lol-game-data/assets/assets/items/3089.png"},
            {"id":3020,"name":if zh {"法师之靴"} else {"Sorcerer's Shoes"},"iconPath":"/lol-game-data/assets/assets/items/3020.png"}
        ])).into_response();
    }
    if uri.path().ends_with(".json") {
        let id: u32 = uri
            .path()
            .rsplit('/')
            .next()
            .unwrap()
            .trim_end_matches(".json")
            .parse()
            .unwrap_or(0);
        return Json(json!({"id":id,"name":if zh {if id==103 {"九尾妖狐"}else{"盲僧"}}else if id==103 {"Ahri"}else{"Lee Sin"}})).into_response();
    }
    (
        [("content-type", "image/png")],
        include_bytes!("../../../tests/fixtures/icon.png").as_slice(),
    )
        .into_response()
}
async fn mock_page(
    State(b): State<Bridge>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    if headers.get("authorization").and_then(|h| h.to_str().ok()) != Some("Bearer synthetic-rso") {
        return (StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let (status, delay) = {
        let mut s = b.scenario.lock().await;
        s.calls += 1;
        (s.status, s.delay)
    };
    if delay > 0 {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
    }
    if status >= 400 {
        return (
            StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            Json(json!({})),
        );
    }
    let p = b
        .service
        .connection
        .read()
        .await
        .player
        .clone()
        .unwrap_or(clients::synthetic_player("TENCENT_HN1"));
    let offset = q
        .get("startIndex")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut page = clients::synthetic_page(&p, offset);
    let generation = b.scenario.lock().await.generation;
    if generation > 0 {
        for (i, g) in page["games"].as_array_mut().unwrap().iter_mut().enumerate() {
            let id = g["json"]["gameId"].as_str().unwrap().to_owned();
            g["json"]["gameId"] = format!("{id}{generation}").into();
            g["json"]["gameCreation"] =
                (chrono_time_ms() + 3600000 - (offset as i64 + i as i64) * 1000).into();
        }
    }
    (StatusCode::OK, Json(page))
}
async fn mock_single(
    State(b): State<Bridge>,
    headers: HeaderMap,
    AxumPath((key, endpoint)): AxumPath<(String, String)>,
) -> impl IntoResponse {
    if headers.get("authorization").and_then(|h| h.to_str().ok()) != Some("Bearer synthetic-rso") {
        return (StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let (status, delay) = {
        let mut s = b.scenario.lock().await;
        s.calls += 1;
        (s.status, s.delay)
    };
    if delay > 0 {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
    }
    if status >= 400 {
        return (
            StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            Json(json!({})),
        );
    }
    let game_id = key.rsplit('_').next().unwrap_or("");
    let p = b
        .service
        .connection
        .read()
        .await
        .player
        .clone()
        .unwrap_or(clients::synthetic_player("TENCENT_HN1"));
    let fixture: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/review/sgp.json")).unwrap();
    let mut value = fixture[if endpoint == "DETAILS" {
        "timeline"
    } else {
        "summary"
    }]
    .clone();
    value["json"]["gameId"] = game_id.into();
    if endpoint == "SUMMARY" {
        if let Ok(m) = storage::review::summary(
            &b.service.pool,
            &MatchRef {
                match_key: format!("{}:{game_id}", p.server_id),
                player_key: p.player_key.clone(),
            },
        )
        .await
        {
            value["json"]["queueId"] = m.queue_id.into();
            value["json"]["gameCreation"] = Value::Null;
            value["json"]["gameCreationDate"] = m.started_at.into();
        }
        value["json"]["platformId"] = p.server_id.trim_start_matches("TENCENT_").into();
        value["json"]["participants"][2]["puuid"] = p.puuid.clone().into();
    }
    (StatusCode::OK, Json(value))
}
async fn scenario(
    State(b): State<Bridge>,
    headers: HeaderMap,
    Json(v): Json<Value>,
) -> impl IntoResponse {
    if !allowed(&headers, &b) {
        return (StatusCode::FORBIDDEN, Json(json!({})));
    }
    let mode = v
        .get("scenario")
        .and_then(Value::as_str)
        .unwrap_or("tencent");
    {
        let mut s = b.scenario.lock().await;
        s.status = v.get("status").and_then(Value::as_u64).unwrap_or(200) as u16;
        s.delay = v
            .get("delay")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(5000);
        s.calls = 0;
        s.generation = v
            .get("generation")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(99) as u32;
    }
    let result = configure(&b, mode).await;
    (StatusCode::OK, Json(json!({"ok":result.is_ok()})))
}
async fn configure(b: &Bridge, mode: &str) -> riftmind_core::contracts::Result<()> {
    b.scenario.lock().await.assets_offline = mode == "offline";
    if mode == "offline" || mode == "no-client" {
        return b
            .service
            .set_connection(ConnectionState::default(), None)
            .await;
    }
    let (region, platform) = if mode == "riot" {
        ("NA", None)
    } else if mode == "unknown" {
        ("INVALID", None)
    } else {
        ("TENCENT", Some("HN1"))
    };
    let ident = domain::identify(
        Some(region),
        platform,
        if mode == "conflict" {
            Some("HN10")
        } else {
            None
        },
    );
    let server = ident.server_id.as_deref().unwrap_or("UNKNOWN");
    let player = clients::synthetic_player(server);
    let instance = ClientInstance {
        id: format!("synthetic-{server}"),
        pid: "1000".into(),
        started_at: "2026-10-19T00:00:00Z".into(),
        identification: ident.clone(),
    };
    *b.service.instances.write().await = vec![instance.clone()];
    let mut c = ConnectionState {
        phase: if mode == "conflict" {
            ConnectionPhase::Conflict
        } else if server == "UNKNOWN" {
            ConnectionPhase::Unsupported
        } else {
            ConnectionPhase::Connected
        },
        instance: Some(instance),
        identification: Some(ident.clone()),
        player: if server != "UNKNOWN" {
            Some(player)
        } else {
            None
        },
        sgp_ready: true,
        lcu_ready: false,
        ..ConnectionState::default()
    };
    if mode == "waiting" {
        c.sgp_ready = false;
        c.phase = ConnectionPhase::WaitingAuth;
    }
    let remote = domain::servers()
        .into_iter()
        .find(|s| s.id == server)
        .map(|s| Arc::new(HttpRemote::for_test(b.mock_base.clone(), s)) as clients::Remote);
    b.service.set_connection(c, remote).await
}
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("harness failed: {}", e);
        std::process::exit(1)
    }
}
async fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let root = std::env::var("RIFTMIND_TEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::temp_dir().join(format!("riftmind-{}", uuid::Uuid::new_v4()))
        });
    tokio::fs::create_dir_all(&root).await?;
    riftmind_core::services::recovery::recover_interrupted_restore(
        &root,
        &JsonSettingsStore(root.join("settings.json")),
    )
    .await
    .map_err(|e| format!("{:?}", e.code))?;
    let pool = storage::open(&root.join("riftmind.db"))
        .await
        .map_err(|e| format!("{:?}", e.code))?;
    let asset_root = std::env::var("RIFTMIND_ASSET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.join("assets"));
    let service = Service::new_with_assets(
        pool,
        root.clone(),
        asset_root,
        Arc::new(JsonSettingsStore(root.join("settings.json"))),
    )
    .await
    .map_err(|e| format!("{:?}", e.code))?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let mock = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let b = Bridge {
        service: service.clone(),
        token: uuid::Uuid::new_v4().to_string(),
        origin: std::env::var("RIFTMIND_ORIGIN").unwrap_or("http://localhost:1420".into()),
        mock_base: format!("http://{}", mock.local_addr()?),
        scenario: Arc::new(Mutex::new(Scenario::default())),
    };
    let mock_app = Router::new()
        .route(
            "/match-history-query/v1/products/lol/player/{puuid}/SUMMARY",
            get(mock_page),
        )
        .route(
            "/match-history-query/v1/products/lol/{key}/{endpoint}",
            get(mock_single),
        )
        .fallback(get(mock_resource))
        .with_state(b.clone());
    tokio::spawn(async move { axum::serve(mock, mock_app).await.unwrap() });
    *service.resources.write().await =
        riftmind_core::services::resources::ResourceClient::fixture(b.mock_base.clone()).unwrap();
    configure(
        &b,
        &std::env::var("RIFTMIND_SCENARIO").unwrap_or("no-client".into()),
    )
    .await
    .map_err(|e| format!("{:?}", e.code))?;
    println!(
        "{}",
        json!({"port":listener.local_addr()?.port(),"token":b.token,"directory":root})
    );
    let app = Router::new()
        .route("/resources/{*path}", get(resource))
        .route("/command", post(command))
        .route("/events", get(events))
        .route("/scenario", post(scenario))
        .route("/health", get(|| async { "ok" }))
        .route(
            "/stats",
            get(|State(b): State<Bridge>| async move {
                {
                    let state = b.scenario.lock().await;
                    Json(json!({"calls":state.calls,"assetCalls":state.asset_calls}))
                }
            }),
        )
        .layer(DefaultBodyLimit::max(65536))
        .with_state(b);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            let _ = service.shutdown().await;
        })
        .await?;
    Ok(())
}
