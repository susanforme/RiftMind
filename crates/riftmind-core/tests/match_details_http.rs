use axum::{Router, http::HeaderMap, routing::get};
use riftmind_core::{
    clients::{self, HttpRemote, MatchRemote},
    contracts::*,
    domain,
    services::Service,
    settings::JsonSettingsStore,
    storage::{self, review},
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

async fn wait_for_task(service: &Service, task: &Task) -> Task {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let current = storage::task(&service.pool, &task.id).await.unwrap();
            if !matches!(current.state, JobState::Queued | JobState::Running) {
                return current;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn single_match_http_paths_load_overview_and_generate_review() {
    for (server_id, platform_id) in [
        ("TENCENT_HN1", "HN1"),
        ("TENCENT_HN10", "HN10"),
        ("NA1", "NA1"),
        ("EUW", "EUW1"),
    ] {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/review/sgp.json")).unwrap();
        let mut summary = fixture["summary"].clone();
        summary["json"]["platformId"] = platform_id.into();
        let timeline = fixture["timeline"].clone();
        let player = clients::synthetic_player(server_id);
        let match_summary = clients::normalize(
            &json!({"games": [summary.clone()]}),
            &player,
            Source::Sgp,
            None,
        )
        .unwrap()
        .remove(0);
        let mut router = Router::new();
        // These routes use the platform ID accepted by SGP, independently of our config.
        for (path, payload) in [
            (
                format!(
                    "/match-history-query/v1/products/lol/player/{}/SUMMARY",
                    player.puuid
                ),
                json!({"games": [summary.clone()]}),
            ),
            (
                format!(
                    "/match-history-query/v1/products/lol/{platform_id}_{}/SUMMARY",
                    match_summary.game_id
                ),
                summary,
            ),
            (
                format!(
                    "/match-history-query/v1/products/lol/{platform_id}_{}/DETAILS",
                    match_summary.game_id
                ),
                timeline,
            ),
        ] {
            router = router.route(
                &path,
                get(move |headers: HeaderMap| async move {
                    assert_eq!(headers["authorization"], "Bearer synthetic-rso");
                    axum::Json(payload)
                }),
            );
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let remote = Arc::new(HttpRemote::for_test(
            format!("http://{}", listener.local_addr().unwrap()),
            domain::servers()
                .into_iter()
                .find(|server| server.id == server_id)
                .unwrap(),
        ));
        let mock_server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        for timeline in [false, true] {
            remote
                .single(&match_summary, timeline, Source::Sgp)
                .await
                .unwrap_or_else(|error| panic!("{server_id} timeline={timeline}: {error:?}"));
        }

        let temporary_root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tmp/match-details-http");
        std::fs::create_dir_all(&temporary_root).unwrap();
        let root = tempfile::tempdir_in(temporary_root).unwrap();
        let service = Service::new(
            storage::open(&root.path().join("riftmind.db"))
                .await
                .unwrap(),
            root.path().into(),
            Arc::new(JsonSettingsStore(root.path().join("settings.json"))),
        )
        .await
        .unwrap();
        service.settings.lock().await.auto_sync = false;
        let identification = if server_id.starts_with("TENCENT_") {
            domain::identify(Some("TENCENT"), Some(platform_id), None)
        } else {
            domain::identify(Some(platform_id), None, None)
        };
        service
            .set_connection(
                ConnectionState {
                    phase: ConnectionPhase::Connected,
                    player: Some(player.clone()),
                    identification: Some(identification),
                    sgp_ready: true,
                    ..ConnectionState::default()
                },
                Some(remote),
            )
            .await
            .unwrap();
        let sync = service
            .start_sync(SyncRequest {
                player_key: player.player_key.clone(),
                pages: 1,
            })
            .await
            .unwrap();
        assert_eq!(
            wait_for_task(&service, &sync).await.state,
            JobState::Completed
        );
        let key = MatchRef {
            match_key: match_summary.match_key,
            player_key: player.player_key,
        };
        let details = service.start_details(key.clone()).await.unwrap();
        let details = wait_for_task(&service, &details).await;
        assert_eq!(details.state, JobState::Completed, "{:?}", details.error);
        assert!(
            service
                .match_scoreboard(key.clone())
                .await
                .unwrap()
                .is_some()
        );
        let input = review::input(&service.pool, &key, None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(input.capabilities["timeline"].status, DataStatus::Ready);
        let report = service
            .start_review(GenerateReview {
                match_key: key.match_key,
                player_key: key.player_key,
                input_revision: input.revision,
            })
            .await
            .unwrap();
        let report = wait_for_task(&service, &report).await;
        assert_eq!(report.state, JobState::Completed, "{:?}", report.error);
        service.shutdown().await.unwrap();
        mock_server.abort();
    }
}
