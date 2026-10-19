use async_trait::async_trait;
use riftmind_core::{
    clients::{self, MatchRemote},
    contracts::*,
    domain,
    services::Service,
    settings::JsonSettingsStore,
    storage,
};
use serde_json::Value;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU32, Ordering},
};
use tokio::sync::{Mutex, Notify};

#[derive(Default)]
struct ResponseGate {
    started: Notify,
    release: Notify,
}

#[derive(Default)]
struct RoomMatchRemote {
    single_calls: AtomicU32,
    wrong_match: AtomicBool,
    fallback: AtomicBool,
    gate: Mutex<Option<Arc<ResponseGate>>>,
}

#[async_trait]
impl MatchRemote for RoomMatchRemote {
    async fn page(&self, player: &Player, offset: u32, source: Source) -> Result<Value> {
        if source == Source::Sgp && self.fallback.load(Ordering::SeqCst) {
            return Err(AppError::new(ErrorCode::EndpointUnsupported));
        }
        Ok(clients::synthetic_page(player, offset))
    }

    async fn single(&self, summary: &MatchSummary, timeline: bool, _: Source) -> Result<Value> {
        assert!(!timeline);
        self.single_calls.fetch_add(1, Ordering::SeqCst);
        if let Some(gate) = self.gate.lock().await.clone() {
            gate.started.notify_one();
            gate.release.notified().await;
        }
        let fixture: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/review/sgp.json")).unwrap();
        let mut raw = fixture["summary"].clone();
        raw["json"]["gameId"] = if self.wrong_match.load(Ordering::SeqCst) {
            "different-match".into()
        } else {
            summary.game_id.clone().into()
        };
        raw["json"]["participants"][2]["puuid"] =
            summary.player_key.split_once(':').unwrap().1.into();
        raw["json"]["participants"][0]["riotIdGameName"] = "Match teammate".into();
        raw["json"]["participants"][0]["riotIdTagline"] = "HN1".into();
        Ok(raw)
    }
}

async fn setup() -> (
    tempfile::TempDir,
    Arc<Service>,
    Arc<RoomMatchRemote>,
    Player,
) {
    let temporary_root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tmp/room-match-details");
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
    let remote = Arc::new(RoomMatchRemote::default());
    service
        .set_connection(
            ConnectionState {
                phase: ConnectionPhase::Connected,
                player: Some(clients::synthetic_player("TENCENT_HN1")),
                identification: Some(domain::identify(Some("TENCENT"), Some("HN1"), None)),
                sgp_ready: true,
                lcu_ready: true,
                ..ConnectionState::default()
            },
            Some(remote.clone()),
        )
        .await
        .unwrap();
    let mut visitor = clients::synthetic_player("TENCENT_HN1");
    visitor.puuid = "room-member".into();
    visitor.player_key = format!("{}:{}", visitor.server_id, visitor.puuid);
    storage::save_player(&service.pool, &visitor).await.unwrap();
    (root, service, remote, visitor)
}

fn recent_match(player: &Player) -> MatchRef {
    let summary = clients::normalize(
        &clients::synthetic_page(player, 0),
        player,
        Source::Sgp,
        None,
    )
    .unwrap()
    .remove(0);
    MatchRef {
        player_key: player.player_key.clone(),
        match_key: summary.match_key,
    }
}

#[tokio::test]
async fn reads_room_member_scoreboards_without_saving_matches_or_review_jobs() {
    let (_root, service, remote, visitor) = setup().await;
    let key = recent_match(&visitor);
    for fallback in [false, true] {
        remote.fallback.store(fallback, Ordering::SeqCst);
        let board = service
            .match_scoreboard(key.clone())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(board.match_key, key.match_key);
        assert_eq!(board.target_id, Some(3));
        assert_eq!(board.participants.len(), 10);
        assert_eq!(board.teams.len(), 2);
        assert_eq!(
            board.source,
            if fallback { Source::Lcu } else { Source::Sgp }
        );
    }
    assert_eq!(remote.single_calls.load(Ordering::SeqCst), 2);
    for table in [
        "match_participants",
        "source_snapshots",
        "analysis_inputs",
        "jobs",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&service.pool)
                .await
                .unwrap(),
            0
        );
    }
}

#[tokio::test]
async fn scoreboard_players_can_open_overviews_without_overwriting_known_profiles() {
    let (_root, service, _remote, visitor) = setup().await;
    let participant_key = "TENCENT_HN1:other-1";
    assert!(
        !storage::players(&service.pool)
            .await
            .unwrap()
            .iter()
            .any(|player| player.player_key == participant_key)
    );
    let match_ref = recent_match(&visitor);
    service.match_scoreboard(match_ref.clone()).await.unwrap();
    let overview = service
        .player_overview(PlayerOverviewQuery {
            player_key: participant_key.into(),
            queue_id: None,
            days: None,
        })
        .await
        .unwrap();
    assert_eq!(overview.profile.player.player_key, participant_key);
    assert_eq!(overview.profile.player.display_name, "Match teammate#HN1");
    assert!(!overview.is_self);
    assert_eq!(overview.matches.len(), 50);

    let mut known_player = overview.profile.player;
    known_player.display_name = "Current name#HN1".into();
    known_player.profile_icon_id = Some(123);
    known_player.summoner_level = Some(200);
    known_player.updated_at = storage::now();
    storage::save_player(&service.pool, &known_player)
        .await
        .unwrap();
    service.match_scoreboard(match_ref).await.unwrap();
    let saved_player = storage::players(&service.pool)
        .await
        .unwrap()
        .into_iter()
        .find(|player| player.player_key == participant_key)
        .unwrap();
    assert_eq!(saved_player.display_name, known_player.display_name);
    assert_eq!(saved_player.profile_icon_id, known_player.profile_icon_id);
    assert_eq!(saved_player.summoner_level, known_player.summoner_level);
    assert_eq!(saved_player.updated_at, known_player.updated_at);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM local_accounts WHERE player_key=?")
            .bind(participant_key)
            .fetch_one(&service.pool)
            .await
            .unwrap(),
        0
    );
    for table in [
        "match_participants",
        "player_profiles",
        "rank_snapshots",
        "jobs",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&service.pool)
                .await
                .unwrap(),
            0
        );
    }
}

#[tokio::test]
async fn saved_scoreboards_register_players_while_offline() {
    let (_root, service, remote, visitor) = setup().await;
    let summary = clients::normalize(
        &clients::synthetic_page(&visitor, 0),
        &visitor,
        Source::Sgp,
        None,
    )
    .unwrap()
    .remove(0);
    let raw = remote.single(&summary, false, Source::Sgp).await.unwrap();
    let task = Task {
        id: "saved-scoreboard".into(),
        player_key: Some(visitor.player_key.clone()),
        kind: JobKind::Sync,
        state: JobState::Completed,
        checkpoint: 1,
        budget: 1,
        session_epoch: "seed".into(),
        updated_at: storage::now(),
        error: None,
        result: None,
        stage: None,
        retry_at: None,
    };
    storage::commit_page(
        &service.pool,
        &task,
        std::slice::from_ref(&summary),
        &serde_json::json!({"games": [raw]}),
        true,
    )
    .await
    .unwrap();
    let mut connection = service.connection.read().await.clone();
    connection.phase = ConnectionPhase::Disconnected;
    service.set_connection(connection, None).await.unwrap();
    let board = service
        .match_scoreboard(MatchRef {
            player_key: visitor.player_key,
            match_key: summary.match_key,
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(board.participants.len(), 10);
    let teammate = storage::players(&service.pool)
        .await
        .unwrap()
        .into_iter()
        .find(|player| player.player_key == "TENCENT_HN1:other-1")
        .unwrap();
    assert_eq!(teammate.display_name, "Match teammate#HN1");
    assert_eq!(remote.single_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn rejects_unlisted_matches_cross_region_requests_and_mismatched_responses() {
    let (_root, service, remote, visitor) = setup().await;
    let key = recent_match(&visitor);
    for (match_key, error) in [
        ("TENCENT_HN1:unknown", ErrorCode::NotFound),
        ("NA1:42", ErrorCode::RegionConflict),
    ] {
        assert_eq!(
            service
                .match_scoreboard(MatchRef {
                    match_key: match_key.into(),
                    ..key.clone()
                })
                .await
                .unwrap_err()
                .code,
            error
        );
    }
    assert_eq!(remote.single_calls.load(Ordering::SeqCst), 0);
    remote.wrong_match.store(true, Ordering::SeqCst);
    assert_eq!(
        service.match_scoreboard(key).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
}

#[tokio::test]
async fn discards_room_match_details_when_the_client_session_changes() {
    let (_root, service, remote, visitor) = setup().await;
    let gate = Arc::new(ResponseGate::default());
    *remote.gate.lock().await = Some(gate.clone());
    let pending = {
        let service = service.clone();
        let key = recent_match(&visitor);
        tokio::spawn(async move { service.match_scoreboard(key).await })
    };
    gate.started.notified().await;
    let mut connection = service.connection.read().await.clone();
    connection.phase = ConnectionPhase::Disconnected;
    connection.player = None;
    service.set_connection(connection, None).await.unwrap();
    gate.release.notify_one();
    assert_eq!(
        pending.await.unwrap().unwrap_err().code,
        ErrorCode::SessionChanged
    );
}
