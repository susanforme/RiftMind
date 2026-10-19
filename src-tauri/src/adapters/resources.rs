use crate::app::Host;
use tauri::{
    AppHandle, Manager,
    http::{Request, Response},
};

pub async fn respond<R: tauri::Runtime>(
    app: &AppHandle<R>,
    main_window: bool,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let origin = if cfg!(dev) {
        app.config()
            .build
            .dev_url
            .as_ref()
            .map(|u| u.origin().ascii_serialization())
            .unwrap_or_default()
    } else {
        "http://tauri.localhost".into()
    };
    let allowed_origin = request
        .headers()
        .get("origin")
        .is_none_or(|v| v.to_str().ok() == Some(origin.as_str()));
    let host = app.state::<Host>();
    let service = host.service.read().await.clone();
    let response = if !main_window || !allowed_origin {
        riftmind_core::services::resources::ResourceResponse {
            status: 403,
            content_type: "text/plain",
            body: vec![],
        }
    } else if let Some(service) = service {
        service
            .resources
            .read()
            .await
            .respond(
                &service.asset_root,
                request.method().as_str(),
                request
                    .uri()
                    .path_and_query()
                    .map(|p| p.as_str())
                    .unwrap_or("/"),
            )
            .await
    } else {
        riftmind_core::services::resources::ResourceResponse {
            status: 503,
            content_type: "text/plain",
            body: vec![],
        }
    };
    Response::builder()
        .status(response.status)
        .header("Content-Type", response.content_type)
        .header("X-Content-Type-Options", "nosniff")
        .header("Access-Control-Allow-Origin", origin)
        // Always reach the disk handler; clearing resources must also work in the current WebView.
        .header("Cache-Control", "no-store")
        .body(response.body)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use riftmind_core::{contracts::*, services::Service, settings::JsonSettingsStore, storage};
    use std::sync::{Arc, atomic::AtomicBool};
    use tokio::sync::RwLock;

    #[tokio::test]
    async fn protocol_serves_disk_bytes_and_restricts_window_origin_method_and_paths() {
        let directory = tempfile::tempdir().unwrap();
        let service = Service::new(
            storage::open(&directory.path().join("riftmind.db"))
                .await
                .unwrap(),
            directory.path().to_owned(),
            Arc::new(JsonSettingsStore(directory.path().join("settings.json"))),
        )
        .await
        .unwrap();
        let path = "/16.20/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/103.png";
        let file = service.asset_root.join("cdragon").join(&path[1..]);
        tokio::fs::create_dir_all(file.parent().unwrap())
            .await
            .unwrap();
        let bytes = include_bytes!("../../../tests/fixtures/icon.png");
        tokio::fs::write(file, bytes).await.unwrap();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().build.dev_url = Some("http://localhost:1420".parse().unwrap());
        let app = tauri::test::mock_builder()
            .manage(Host {
                service: RwLock::new(Some(service)),
                phase: RwLock::new(AppPhase::Ready),
                sql_registered: AtomicBool::new(false),
                quitting: AtomicBool::new(false),
            })
            .build(context)
            .unwrap();
        let origin = if cfg!(dev) {
            "http://localhost:1420"
        } else {
            "http://tauri.localhost"
        };
        let request = || {
            Request::builder()
                .uri(format!("http://cdragon.localhost{path}"))
                .header("Origin", origin)
                .body(vec![])
                .unwrap()
        };
        let response = respond(app.handle(), true, request()).await;
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "image/png");
        assert_eq!(response.headers()["access-control-allow-origin"], origin);
        assert_eq!(response.body(), bytes);
        assert_eq!(respond(app.handle(), false, request()).await.status(), 403);
        let evil = Request::builder()
            .uri(path)
            .header("Origin", "https://example.com")
            .body(vec![])
            .unwrap();
        assert_eq!(respond(app.handle(), true, evil).await.status(), 403);
        let post = Request::builder()
            .method("POST")
            .uri(path)
            .body(vec![])
            .unwrap();
        assert_eq!(respond(app.handle(), true, post).await.status(), 405);
        let traversal = Request::builder()
            .uri("/16.20/../../settings.json")
            .body(vec![])
            .unwrap();
        assert_eq!(respond(app.handle(), true, traversal).await.status(), 400);
        *app.state::<Host>().service.write().await = None;
        assert_eq!(respond(app.handle(), true, request()).await.status(), 503);
    }
}
