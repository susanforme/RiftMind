use async_trait::async_trait;
use riftmind_core::{
    clients::{self, MatchRemote},
    contracts::*,
    domain,
    services::Service,
    settings::{self, JsonSettingsStore, SettingsStore},
    storage,
};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};
use tokio::sync::Notify;
async fn service(root: &Path) -> Arc<Service> {
    Service::new(
        storage::open(&root.join("riftmind.db")).await.unwrap(),
        root.to_path_buf(),
        Arc::new(JsonSettingsStore(root.join("settings.json"))),
    )
    .await
    .unwrap()
}
struct Remote;
#[async_trait]
impl MatchRemote for Remote {
    async fn page(&self, p: &Player, offset: u32, _: Source) -> Result<Value> {
        Ok(clients::synthetic_page(p, offset))
    }
}
async fn connect(s: &Arc<Service>, server: &str) {
    let ident = if server == "NA1" {
        domain::identify(Some("NA"), None, None)
    } else {
        domain::identify(Some("TENCENT"), Some("HN1"), None)
    };
    s.settings.lock().await.auto_sync = false;
    s.set_connection(
        ConnectionState {
            phase: ConnectionPhase::Connected,
            player: Some(clients::synthetic_player(server)),
            identification: Some(ident),
            sgp_ready: true,
            ..ConnectionState::default()
        },
        Some(Arc::new(Remote)),
    )
    .await
    .unwrap();
}
async fn wait(s: &Service, id: &str) -> Task {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let t = storage::task(&s.pool, id).await.unwrap();
            if !matches!(t.state, JobState::Queued | JobState::Running) {
                return t;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}
fn query(player: &str) -> MatchQuery {
    MatchQuery {
        player_key: player.into(),
        queue_id: None,
        champion_id: None,
        from: None,
        to: None,
        cursor: None,
        page_size: Some(50),
    }
}
#[test]
fn identify_aliases_conflicts_and_no_guessing() {
    for (r, id) in [
        ("NA", "NA1"),
        ("na1", "NA1"),
        ("EUW1", "EUW"),
        ("EUW", "EUW"),
        ("OCE", "OC1"),
        ("JP1", "JP"),
        ("BR", "BR1"),
    ] {
        assert_eq!(
            domain::identify(Some(r), None, None).server_id.as_deref(),
            Some(id)
        );
    }
    assert_eq!(
        domain::parse_identification("--region=TENCENT --rso-platform-id=HN1")
            .server_id
            .as_deref(),
        Some("TENCENT_HN1")
    );
    assert!(
        domain::identify(Some("TENCENT"), None, None)
            .server_id
            .is_none()
    );
    assert!(
        domain::identify(None, Some("HN1"), None)
            .server_id
            .is_none()
    );
    assert!(
        domain::identify(Some("TENCENT"), Some("HN1"), Some("HN10"))
            .server_id
            .is_none()
    );
    for s in domain::servers() {
        assert!(s.match_history.starts_with("https://"));
        assert_eq!(s.verification, "reference_only");
    }
}
#[test]
fn source_policy_never_bypasses_auth_or_cross_region() {
    let id = domain::identify(Some("TENCENT"), Some("HN1"), None);
    assert_eq!(
        domain::choose_source(&id, false, false, "TENCENT_HN1")
            .unwrap_err()
            .code,
        ErrorCode::WaitingAuth
    );
    assert_eq!(
        domain::choose_source(&id, true, false, "TENCENT_HN1").unwrap(),
        Source::Sgp
    );
    assert_eq!(
        domain::choose_source(&id, false, true, "TENCENT_HN1").unwrap(),
        Source::Lcu
    );
    assert!(domain::choose_source(&id, false, true, "NA1").is_err());
    let pbe = domain::identify(Some("PBE"), None, None);
    assert!(domain::choose_source(&pbe, true, false, "PBE").is_err());
}
#[test]
fn normalization_preserves_large_ids_unknown_and_null() {
    let p = clients::synthetic_player("NA1");
    let raw = json!({"games":[{"json":{"gameId":"9007199254740999","gameCreation":1792108800000_i64,"gameVersion":"16.20.1","queueId":99999,"participants":[{"puuid":"synthetic-player","championId":99999}]}}]});
    let a = clients::normalize(&raw, &p, Source::Sgp, None).unwrap();
    assert_eq!(a[0].game_id, "9007199254740999");
    assert_eq!(a[0].kills, None);
    assert_eq!(a[0].outcome, Outcome::Unknown);
    assert_eq!(a[0].queue_id, Some(99999));
}
#[tokio::test]
async fn sqlite_sync_deduplicates_revisions_and_stable_pagination() {
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    connect(&s, "NA1").await;
    let p = "NA1:synthetic-player";
    let t = s
        .start_sync(SyncRequest {
            player_key: p.into(),
            pages: 3,
        })
        .await
        .unwrap();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Completed);
    let page = storage::list(&s.pool, query(p)).await.unwrap();
    assert_eq!(page.total, 125);
    assert_eq!(page.items.len(), 50);
    assert!(page.next_cursor.is_some());
    let mut q = query(p);
    q.cursor = page.next_cursor;
    let second = storage::list(&s.pool, q).await.unwrap();
    assert!(
        page.items
            .iter()
            .all(|a| second.items.iter().all(|b| a.match_key != b.match_key))
    );
    let t = s
        .start_sync(SyncRequest {
            player_key: p.into(),
            pages: 3,
        })
        .await
        .unwrap();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Completed);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM match_revisions")
        .fetch_one(&s.pool)
        .await
        .unwrap();
    assert_eq!(n, 125);
    let mut q = query(p);
    q.queue_id = Some(420);
    let filtered = storage::list(&s.pool, q).await.unwrap();
    assert!(filtered.items.iter().all(|m| m.queue_id == Some(420)));
    assert!(filtered.total < 125);
    s.shutdown().await.unwrap();
    let s = service(root.path()).await;
    assert_eq!(storage::list(&s.pool, query(p)).await.unwrap().total, 125);
    assert_eq!(
        s.connection.read().await.phase,
        ConnectionPhase::Disconnected
    );
}
#[tokio::test]
async fn settings_conflict_atomic_failure_and_restart() {
    let root = tempfile::tempdir().unwrap();
    let store = JsonSettingsStore(root.path().join("settings.json"));
    let mut current = Settings::default();
    store.save(&current).await.unwrap();
    let patch: SettingsPatch =
        serde_json::from_value(json!({"languagePreference":"en-US","colorModePreference":"dark"}))
            .unwrap();
    let next = settings::apply(
        &current,
        UpdateSettings {
            expected_revision: 0,
            patch: patch.clone(),
        },
    )
    .unwrap();
    store.save(&next).await.unwrap();
    current = store.load().await.unwrap();
    assert_eq!(current.language_preference, "en-US");
    assert_eq!(current.color_mode_preference, ColorMode::Dark);
    assert_eq!(
        settings::apply(
            &current,
            UpdateSettings {
                expected_revision: 0,
                patch
            }
        )
        .unwrap_err()
        .code,
        ErrorCode::SettingsConflict
    );
    let bad = JsonSettingsStore(root.path().join("missing/setting.json"));
    assert!(bad.save(&current).await.is_err());
    assert_eq!(store.load().await.unwrap().revision, 1);
}
#[tokio::test]
async fn backup_restore_preserves_rollback_copy_and_resets_epoch() {
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    connect(&s, "NA1").await;
    let t = s
        .start_sync(SyncRequest {
            player_key: "NA1:synthetic-player".into(),
            pages: 1,
        })
        .await
        .unwrap();
    wait(&s, &t.id).await;
    let backup = s.backup().await.unwrap();
    let epoch = backup.workspace_epoch;
    sqlx::query("DELETE FROM match_revisions")
        .execute(&s.pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM match_participants")
        .execute(&s.pool)
        .await
        .unwrap();
    let restored = s.restore(&backup.reference).await.unwrap();
    assert_ne!(restored.workspace_epoch, epoch);
    assert_eq!(
        storage::list(&s.pool, query("NA1:synthetic-player"))
            .await
            .unwrap()
            .total,
        50
    );
    assert!(s.restore("../../other").await.is_err());
    let file = root
        .path()
        .join("backups")
        .join(format!("{}.riftmind", backup.reference));
    tokio::fs::write(file, b"{}").await.unwrap();
    assert!(s.restore(&backup.reference).await.is_err());
    assert_eq!(
        storage::list(&s.pool, query("NA1:synthetic-player"))
            .await
            .unwrap()
            .total,
        50
    );
}
struct SlowRemote {
    entered: Arc<Notify>,
    release: Arc<Notify>,
}
#[async_trait]
impl MatchRemote for SlowRemote {
    async fn page(&self, p: &Player, offset: u32, _: Source) -> Result<Value> {
        self.entered.notify_one();
        self.release.notified().await;
        Ok(clients::synthetic_page(p, offset))
    }
}
#[tokio::test]
async fn late_response_after_switch_cannot_commit() {
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    connect(&s, "NA1").await;
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    *s.remote.write().await = Some(Arc::new(SlowRemote {
        entered: entered.clone(),
        release: release.clone(),
    }));
    let t = s
        .start_sync(SyncRequest {
            player_key: "NA1:synthetic-player".into(),
            pages: 3,
        })
        .await
        .unwrap();
    entered.notified().await;
    connect(&s, "TENCENT_HN1").await;
    release.notify_one();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Cancelled);
    assert_eq!(
        storage::list(&s.pool, query("NA1:synthetic-player"))
            .await
            .unwrap()
            .total,
        0
    );
}
#[tokio::test]
async fn cancel_keeps_committed_data_and_merges_duplicates() {
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    connect(&s, "NA1").await;
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    *s.remote.write().await = Some(Arc::new(SlowRemote {
        entered: entered.clone(),
        release: release.clone(),
    }));
    let req = SyncRequest {
        player_key: "NA1:synthetic-player".into(),
        pages: 3,
    };
    let t = s.start_sync(req.clone()).await.unwrap();
    entered.notified().await;
    assert_eq!(s.start_sync(req).await.unwrap().id, t.id);
    s.dispatch(Command::cancel_task(IdInput { id: t.id.clone() }))
        .await
        .unwrap();
    release.notify_one();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Cancelled);
}
#[tokio::test]
async fn newer_schema_is_rejected_without_mutation() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("db");
    let pool = storage::open(&path).await.unwrap();
    sqlx::query("PRAGMA user_version=99")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    assert!(storage::open(&path).await.is_err());
    let pool = storage::connect(&path).await.unwrap();
    let v: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(v, 99);
}
#[tokio::test]
async fn http_403_429_and_token_boundary() {
    use axum::{
        Router,
        http::{HeaderMap, StatusCode},
        routing::get,
    };
    let app = Router::new().route(
        "/match-history-query/v1/products/lol/player/synthetic-player/SUMMARY",
        get(|headers: HeaderMap| async move {
            assert_eq!(
                headers.get("authorization").unwrap(),
                "Bearer synthetic-rso"
            );
            (
                StatusCode::TOO_MANY_REQUESTS,
                [("retry-after", "120")],
                "{}",
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let remote = clients::HttpRemote::for_test(
        base,
        domain::servers()
            .into_iter()
            .find(|s| s.id == "NA1")
            .unwrap(),
    );
    let e = remote
        .page(&clients::synthetic_player("NA1"), 0, Source::Sgp)
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::RateLimited);
    assert_eq!(e.params["retryAfter"], "120");
    server.abort();
}
#[test]
fn generated_contracts_cover_registry_error_nullable_and_event() {
    let ts = generate_types();
    assert!(ts.contains("workspace-reset") == false);
    assert!(ts.contains("CommandMap"));
    assert!(ts.contains("requestId: string"));
    assert!(ts.contains("playerKey: string | null"));
    assert!(ts.contains("install_update"));
}

#[tokio::test]
async fn resources_cached_offline_and_clear_retains_manifest() {
    use axum::{
        Json, Router, extract::OriginalUri, http::HeaderMap, response::IntoResponse, routing::get,
    };
    let app = Router::new().fallback(get(|uri: OriginalUri, headers: HeaderMap| async move {
        assert!(!headers.contains_key("authorization"));
        if uri.path() == "/json/" {
            return Json(json!([{"name":"16.20"}])).into_response();
        }
        if uri.path().ends_with(".json") {
            return Json(json!({"id":103,"name":"Ahri"})).into_response();
        }
        (
            [(axum::http::header::CONTENT_TYPE, "image/png")],
            include_bytes!("../../../tests/fixtures/icon.png").as_slice(),
        )
            .into_response()
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    *s.resources.write().await =
        riftmind_core::services::resources::ResourceClient::fixture(base).unwrap();
    let request = AssetRequest {
        version: "16.20.1".into(),
        locale: "en-US".into(),
        champion_ids: vec![103],
        resource_ids: None,
    };
    let value = s
        .dispatch(Command::resolve_assets(request.clone()))
        .await
        .unwrap();
    let a: Vec<Asset> = serde_json::from_value(value).unwrap();
    assert_eq!(a[0].actual_version.as_deref(), Some("16.20"));
    assert_eq!(a[0].availability, "ready");
    assert!(
        a[0].reference
            .as_ref()
            .unwrap()
            .starts_with("http://cdragon.localhost/16.20/")
    );
    let path = a[0]
        .reference
        .as_ref()
        .unwrap()
        .strip_prefix("http://cdragon.localhost")
        .unwrap();
    assert_eq!(
        s.resources
            .read()
            .await
            .respond(&s.asset_root, "GET", path)
            .await
            .status,
        200
    );
    server.abort();
    let value = s.dispatch(Command::resolve_assets(request)).await.unwrap();
    assert_eq!(value[0]["reference"], a[0].reference.clone().unwrap());
    assert_eq!(
        s.resources
            .read()
            .await
            .respond(&s.asset_root, "GET", path)
            .await
            .status,
        200
    );
    s.dispatch(Command::clear_asset_cache(Empty {}))
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM resource_manifests")
        .fetch_one(&s.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let missing = s
        .dispatch(Command::resolve_assets(AssetRequest {
            version: "1.1.1".into(),
            locale: "en-US".into(),
            champion_ids: vec![103],
            resource_ids: None,
        }))
        .await
        .unwrap();
    assert_eq!(missing[0]["availability"], "missing");
    assert!(missing[0]["actualVersion"].is_null());
    assert!(
        s.dispatch(Command::resolve_assets(AssetRequest {
            version: "../../secret".into(),
            locale: "en-US".into(),
            champion_ids: vec![103],
            resource_ids: None
        }))
        .await
        .is_err()
    );
}
#[tokio::test]
async fn interrupted_job_resumes_after_restart() {
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    connect(&s, "NA1").await;
    sqlx::query("INSERT INTO jobs(id,player_key,state,checkpoint,budget,session_epoch,updated_at) VALUES('interrupted-fixture','NA1:synthetic-player','running',1,3,'old',?)").bind(storage::now()).execute(&s.pool).await.unwrap();
    s.pool.close().await;
    let s = service(root.path()).await;
    connect(&s, "NA1").await;
    let task = s
        .start_sync(SyncRequest {
            player_key: "NA1:synthetic-player".into(),
            pages: 3,
        })
        .await
        .unwrap();
    assert_eq!(task.id, "interrupted-fixture");
    assert_eq!(wait(&s, &task.id).await.state, JobState::Completed);
    assert_eq!(
        storage::list(&s.pool, query("NA1:synthetic-player"))
            .await
            .unwrap()
            .total,
        125
    );
}
#[tokio::test]
async fn ten_thousand_summaries_query_budget() {
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    let p = clients::synthetic_player("NA1");
    storage::save_player(&s.pool, &p).await.unwrap();
    let base = clients::normalize(&clients::synthetic_page(&p, 0), &p, Source::Sgp, None)
        .unwrap()
        .remove(0);
    let task = Task {
        stage: None,
        retry_at: None,
        id: "performance".into(),
        kind: JobKind::Sync,
        result: None,
        player_key: Some(p.player_key.clone()),
        state: JobState::Running,
        checkpoint: 1,
        budget: 1,
        session_epoch: "performance".into(),
        updated_at: storage::now(),
        error: None,
    };
    sqlx::query("INSERT INTO jobs(id,player_key,state,checkpoint,budget,session_epoch,updated_at) VALUES('performance',?,'running',0,1,'performance',?)").bind(&p.player_key).bind(storage::now()).execute(&s.pool).await.unwrap();
    let started = std::time::Instant::now();
    for chunk in 0..100 {
        let rows: Vec<_> = (0..100)
            .map(|j| {
                let mut row = base.clone();
                let i = chunk * 100 + j;
                row.game_id = i.to_string();
                row.match_key = format!("NA1:{i}");
                row.started_at = (chrono::Utc::now() - chrono::Duration::seconds(i))
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                row
            })
            .collect();
        storage::commit_page(&s.pool, &task, &rows, &json!({"batch":chunk}), false)
            .await
            .unwrap();
    }
    let write_ms = started.elapsed().as_millis();
    let mut times = vec![];
    for _ in 0..100 {
        let now = std::time::Instant::now();
        let page = storage::list(&s.pool, query(&p.player_key)).await.unwrap();
        assert_eq!(page.total, 10000);
        assert_eq!(page.items.len(), 50);
        times.push(now.elapsed().as_secs_f64() * 1000.);
    }
    times.sort_by(f64::total_cmp);
    assert!(times[94] < 500., "p95 {}ms", times[94]);
    println!(
        "PERFORMANCE {}",
        json!({"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"records":10000,"pageSize":50,"queryP95Ms":times[94],"writeMs":write_ms,"memory":"not_measured"})
    );
}

#[tokio::test]
async fn maintenance_tasks_persist_results_and_restore_remains_observable() {
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    let task = s.start_maintenance(JobKind::Backup, None).await.unwrap();
    assert_eq!(task.kind, JobKind::Backup);
    let result = s.await_task(&task.id).await.unwrap();
    assert!(
        root.path()
            .join("backups")
            .join(format!("{}.riftmind", result.reference))
            .exists()
    );
    let restore = s
        .start_maintenance(JobKind::Restore, Some(result.reference))
        .await
        .unwrap();
    let restored = s.await_task(&restore.id).await.unwrap();
    assert_ne!(restored.workspace_epoch, result.workspace_epoch);
    let snapshot = storage::task(&s.pool, &restore.id).await.unwrap();
    assert_eq!(snapshot.state, JobState::Completed);
    assert_eq!(
        snapshot.result.unwrap().workspace_epoch,
        restored.workspace_epoch
    );
    s.shutdown().await.unwrap();
}
#[test]
fn lcu_identity_mapping_and_cs_do_not_select_another_participant() {
    let p = clients::synthetic_player("NA1");
    let raw = json!({"games":{"games":[{"gameId":"1234","gameCreation":1792108800000_i64,"participants":[{"participantId":1,"championId":64,"stats":{"totalMinionsKilled":10,"neutralMinionsKilled":20}},{"participantId":2,"championId":103,"stats":{"totalMinionsKilled":100,"neutralMinionsKilled":20}}],"participantIdentities":[{"participantId":1,"player":{"puuid":"other"}},{"participantId":2,"player":{"puuid":"synthetic-player"}}]}]}});
    let rows = clients::normalize(&raw, &p, Source::Lcu, None).unwrap();
    assert_eq!(rows[0].champion_id, Some(103));
    assert_eq!(rows[0].cs, Some(120));
    let wrong = clients::synthetic_player("NA1");
    let mut raw = clients::synthetic_page(&wrong, 0);
    raw["games"][0]["json"]["participants"][0]["puuid"] = "other".into();
    assert!(clients::normalize(&raw, &p, Source::Sgp, None).is_err());
}
#[tokio::test]
async fn interrupted_restore_rolls_back_database_and_settings_together() {
    let root = tempfile::tempdir().unwrap();
    let s = service(root.path()).await;
    let backup = s.backup().await.unwrap();
    s.pool.close().await;
    let store = JsonSettingsStore(root.path().join("settings.json"));
    store
        .save(&Settings {
            language_preference: "en-US".into(),
            ..Settings::default()
        })
        .await
        .unwrap();
    tokio::fs::write(root.path().join("riftmind.db"), b"incomplete-replacement")
        .await
        .unwrap();
    tokio::fs::write(
        root.path().join("restore-journal.json"),
        serde_json::to_vec(&json!({"rollbackBackup":backup.reference})).unwrap(),
    )
    .await
    .unwrap();
    assert!(
        riftmind_core::services::recovery::recover_interrupted_restore(root.path(), &store)
            .await
            .unwrap()
    );
    assert_eq!(store.load().await.unwrap().language_preference, "system");
    let s = service(root.path()).await;
    assert!(storage::players(&s.pool).await.unwrap().is_empty());
    assert!(!root.path().join("restore-journal.json").exists());
}
#[test]
fn remote_platform_mismatch_is_not_projected_into_current_server() {
    let p = clients::synthetic_player("NA1");
    let mut raw = clients::synthetic_page(&p, 0);
    raw["games"][0]["json"]["platformId"] = "EUW1".into();
    assert_eq!(
        clients::normalize(&raw, &p, Source::Sgp, None)
            .unwrap_err()
            .code,
        ErrorCode::RegionConflict
    );
}
