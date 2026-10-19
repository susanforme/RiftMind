use async_trait::async_trait;
use riftmind_core::{
    clients::{self, MatchRemote},
    contracts::*,
    domain::{self, analysis},
    services::{Service, live::normalize_live, players::sample},
    settings::JsonSettingsStore,
    storage::{self, review as db},
};
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
    time::Instant,
};
use tokio::sync::{Mutex, Notify};
fn live() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/scouting/live.json")).unwrap()
}
fn connection(server: &str) -> ConnectionState {
    ConnectionState {
        phase: ConnectionPhase::Connected,
        player: Some(clients::synthetic_player(server)),
        identification: Some(if server == "NA1" {
            domain::identify(Some("NA"), None, None)
        } else {
            domain::identify(Some("TENCENT"), Some("HN1"), None)
        }),
        sgp_ready: true,
        ..ConnectionState::default()
    }
}
struct Remote {
    ranks: Mutex<Value>,
    raw: Mutex<Value>,
    calls: AtomicU32,
    delay: AtomicU32,
    status: AtomicU32,
    response_gate: Mutex<Option<Arc<ResponseGate>>>,
}
#[derive(Default)]
struct ResponseGate {
    started: Notify,
    release: Notify,
}
impl Remote {
    async fn wait_for_response_release(&self) {
        let gate = self.response_gate.lock().await.clone();
        if let Some(gate) = gate {
            gate.started.notify_one();
            gate.release.notified().await;
        }
    }
}
#[async_trait]
impl MatchRemote for Remote {
    async fn page(&self, p: &Player, offset: u32, _: Source) -> Result<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(std::time::Duration::from_millis(
            if p.puuid == "slow-player" {
                100
            } else {
                self.delay.load(Ordering::SeqCst) as u64
            },
        ))
        .await;
        match self.status.load(Ordering::SeqCst) {
            403 => Err(AppError::new(ErrorCode::Forbidden)),
            429 => Err(AppError::new(ErrorCode::RateLimited)),
            _ => Ok(clients::synthetic_page(p, offset)),
        }
    }
    async fn current_match(&self) -> Result<Value> {
        let v = self.raw.lock().await.clone();
        self.wait_for_response_release().await;
        tokio::time::sleep(std::time::Duration::from_millis(
            self.delay.load(Ordering::SeqCst) as u64,
        ))
        .await;
        Ok(v)
    }
    async fn search(&self, q: &str) -> Result<Value> {
        self.wait_for_response_release().await;
        tokio::time::sleep(std::time::Duration::from_millis(
            self.delay.load(Ordering::SeqCst) as u64,
        ))
        .await;
        if q == "missing#TEST" {
            return Err(AppError::new(ErrorCode::NotFound));
        }
        Ok(json!({"puuid":"searched-player","gameName":q}))
    }
    async fn ranks(&self, _: &Player) -> Result<Value> {
        Ok(self.ranks.lock().await.clone())
    }
}
async fn setup(root: &Path) -> (Arc<Service>, Arc<Remote>) {
    let s = Service::new(
        storage::open(&root.join("riftmind.db")).await.unwrap(),
        root.into(),
        Arc::new(JsonSettingsStore(root.join("settings.json"))),
    )
    .await
    .unwrap();
    s.settings.lock().await.auto_sync = false;
    let r = Arc::new(Remote {
        ranks: Mutex::new(json!({"queues":[]})),
        raw: Mutex::new(live()),
        calls: AtomicU32::new(0),
        delay: AtomicU32::new(0),
        status: AtomicU32::new(200),
        response_gate: Mutex::new(None),
    });
    s.set_connection(connection("TENCENT_HN1"), Some(r.clone()))
        .await
        .unwrap();
    (s, r)
}
fn filter() -> AnalysisFilter {
    AnalysisFilter {
        player_key: "TENCENT_HN1:synthetic-player".into(),
        queue_id: None,
        position: None,
        patch: None,
        from: None,
        to: None,
        champion_id: None,
    }
}
async fn seed(
    s: &Service,
    id: &str,
    outcome: Outcome,
    deaths: Option<u32>,
    timeline: bool,
) -> (MatchSummary, AnalysisInput, ReviewReport) {
    let p = clients::synthetic_player("TENCENT_HN1");
    storage::save_player(&s.pool, &p).await.unwrap();
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/review/sgp.json")).unwrap();
    let mut raw = f["summary"].clone();
    raw["json"]["gameId"] = id.into();
    let mut t = f["timeline"].clone();
    t["json"]["gameId"] = id.into();
    let mut m = clients::normalize(&json!({"games":[raw.clone()]}), &p, Source::Sgp, None)
        .unwrap()
        .remove(0);
    m.outcome = outcome;
    m.deaths = deaths;
    let task = Task {
        id: "seed".into(),
        player_key: Some(p.player_key.clone()),
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
        &s.pool,
        &task,
        &[m.clone()],
        &json!({"games":[raw.clone()]}),
        false,
    )
    .await
    .unwrap();
    let mut input =
        analysis::normalize(&raw, if timeline { Some(&t) } else { None }, &m, &p.puuid).unwrap();
    input.context.remake = m.outcome == Outcome::Remake;
    input
        .context
        .participants
        .iter_mut()
        .find(|p| p.id == input.context.target_id)
        .unwrap()
        .deaths = deaths;
    let mut tx = s.pool.begin().await.unwrap();
    let input = db::save_input_tx(
        &mut tx,
        input,
        &m,
        &raw,
        if timeline { Some(&t) } else { None },
        &Source::Sgp,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let mut report = analysis::report(&input).unwrap();
    report.id = format!("report-{id}");
    report.revision = 1;
    report.generated_at = storage::now();
    sqlx::query("INSERT INTO reviews VALUES(?,?,?,?,?,?,?)")
        .bind(&report.id)
        .bind(&m.match_key)
        .bind(&p.player_key)
        .bind(&input.id)
        .bind(1)
        .bind(&report.rule_version)
        .bind(serde_json::to_string(&report).unwrap())
        .execute(&s.pool)
        .await
        .unwrap();
    (m, input, report)
}
#[test]
fn live_generations_handoff_cancel_anonymous_and_nonstandard_teams() {
    let c = connection("TENCENT_HN1");
    let mut raw = live();
    let a = normalize_live(&raw, &c, &LiveSnapshot::default()).unwrap();
    assert_eq!(a.seats.len(), 10);
    assert_eq!(a.seats[0].team_id, 1);
    assert_eq!(a.seats[5].team_id, 2);
    assert!(a.seats[0].current);
    assert!(a.game_id.is_none());
    raw["champSelect"]["myTeam"][0]["championId"] = 64.into();
    raw["champSelect"]["theirTeam"][0]["puuid"] = Value::Null;
    let b = normalize_live(&raw, &c, &a).unwrap();
    assert_eq!(b.generation, a.generation);
    assert!(b.seats[5].player.is_none());
    assert_eq!(b.seats[0].champion_id, Some(64));
    raw["phase"] = "GameStart".into();
    raw["game"]["gameData"]["gameId"] = "900719925474101".into();
    let g = normalize_live(&raw, &c, &b).unwrap();
    assert_eq!(g.generation, b.generation);
    raw["phase"] = "EndOfGame".into();
    raw["game"] = Value::Null;
    let end = normalize_live(&raw, &c, &g).unwrap();
    assert_eq!(end.seats.len(), 10);
    assert_eq!(end.game_id, g.game_id);
    raw["phase"] = "Matchmaking".into();
    let cancel = normalize_live(&raw, &c, &end).unwrap();
    assert_eq!(cancel.seats.len(), 1);
    assert!(cancel.seats[0].current);
    assert!(cancel.seats[0].champion_id.is_none());
    assert!(cancel.game_id.is_none());
    assert!(cancel.bans.is_empty());
    raw["phase"] = "ChampSelect".into();
    raw["champSelect"]["myTeam"]
        .as_array_mut()
        .unwrap()
        .truncate(2);
    let next = normalize_live(&raw, &c, &cancel).unwrap();
    assert_ne!(next.generation, g.generation);
    assert_eq!(next.seats.len(), 7);
}
#[test]
fn lobby_members_persist_through_queue_phases_and_reconcile_joins_and_leaves() {
    let connection = connection("TENCENT_HN1");
    let lobby: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/scouting/lobby.json")).unwrap();
    let mut raw = json!({"phase":"Lobby", "lobby":lobby});
    let selected = normalize_live(&live(), &connection, &LiveSnapshot::default()).unwrap();
    let party = normalize_live(&raw, &connection, &selected).unwrap();
    assert_eq!(party.seats.len(), 2);
    assert_eq!(party.queue_id, Some(420));
    assert_eq!(party.mode.as_deref(), Some("CLASSIC"));
    assert_eq!(party.seats[0].team_id, 0);
    assert!(party.seats[0].current);
    assert_eq!(
        party.seats[0].player.as_ref().unwrap().profile_icon_id,
        Some(0)
    );
    assert_eq!(
        party.seats[1].player.as_ref().unwrap().summoner_level,
        Some(225)
    );
    assert_eq!(party.seats[1].position.as_deref(), Some("JUNGLE"));
    assert!(
        party
            .seats
            .iter()
            .all(|seat| seat.champion_id.is_none() && seat.spell_ids.is_empty())
    );
    assert!(party.game_id.is_none());
    assert!(party.bans.is_empty());
    assert_ne!(party.generation, selected.generation);
    for phase in ["Matchmaking", "ReadyCheck", "Lobby"] {
        raw["phase"] = phase.into();
        let queued = normalize_live(&raw, &connection, &party).unwrap();
        assert_eq!(queued.seats.len(), 2);
        assert_eq!(queued.generation, party.generation);
    }
    raw["lobby"]["members"].as_array_mut().unwrap().truncate(1);
    let solo = normalize_live(&raw, &connection, &party).unwrap();
    assert_eq!(solo.seats.len(), 1);
    assert!(solo.seats[0].current);
    raw["lobby"]["members"]
        .as_array_mut()
        .unwrap()
        .push(lobby["members"][1].clone());
    let joined = normalize_live(&raw, &connection, &solo).unwrap();
    assert_eq!(joined.seats.len(), 2);
    assert_eq!(joined.generation, solo.generation);
    let champion_select = normalize_live(&live(), &connection, &joined).unwrap();
    assert_eq!(champion_select.seats.len(), 10);
    assert_ne!(champion_select.generation, joined.generation);
    let left = normalize_live(&json!({"phase":"None"}), &connection, &joined).unwrap();
    assert!(left.seats.is_empty());
}

#[test]
fn lobby_falls_back_to_local_identity_without_reusing_an_old_roster() {
    let connection = connection("TENCENT_HN1");
    let old = normalize_live(&live(), &connection, &LiveSnapshot::default()).unwrap();
    let missing = normalize_live(&json!({"phase":"Lobby"}), &connection, &old).unwrap();
    assert_eq!(missing.seats.len(), 1);
    assert!(missing.seats[0].current);
    assert_eq!(
        missing.seats[0].player.as_ref().unwrap().player_key,
        connection.player.as_ref().unwrap().player_key
    );
    assert!(missing.seats[0].champion_id.is_none());
    let lobby: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/scouting/lobby.json")).unwrap();
    let mut raw = json!({"phase":"Lobby", "lobby":lobby});
    raw["lobby"]["members"][1]["isBot"] = true.into();
    let no_bot = normalize_live(&raw, &connection, &old).unwrap();
    assert_eq!(no_bot.seats.len(), 1);
    raw["lobby"]["members"][1]["isBot"] = false.into();
    raw["lobby"]["members"][1]["isSpectator"] = true.into();
    assert_eq!(
        normalize_live(&raw, &connection, &old).unwrap().seats.len(),
        1
    );
    raw["lobby"]["members"][0]["puuid"] = Value::Null;
    let local = normalize_live(&raw, &connection, &old).unwrap();
    assert_eq!(local.seats.len(), 1);
    assert!(local.seats[0].current);
    let mut switched = connection.clone();
    switched.session_epoch = "another-session".into();
    assert_ne!(
        normalize_live(&raw, &switched, &local).unwrap().generation,
        local.generation
    );
    raw["lobby"]["members"] = json!(vec![lobby["members"][0].clone(); 33]);
    assert_eq!(
        normalize_live(&raw, &connection, &old).unwrap_err().code,
        ErrorCode::InvalidInput
    );
}
#[tokio::test]
async fn lobby_profiles_cache_only_self_and_refresh_party_while_queueing() {
    let root = tempfile::tempdir().unwrap();
    let (service, remote) = setup(root.path()).await;
    let lobby: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/scouting/lobby.json")).unwrap();
    *remote.raw.lock().await = json!({"phase":"Lobby", "lobby":lobby});
    let party = service.refresh_live().await.unwrap();
    for seat in &party.seats {
        let profile = service
            .player_profile(PlayerProfileQuery {
                player_key: seat.player.as_ref().unwrap().player_key.clone(),
                queue_id: party.queue_id,
                champion_id: None,
            })
            .await
            .unwrap();
        assert!(profile.games > 0);
        assert_eq!(profile.player.profile_icon_id, Some(0));
        assert!(profile.player.summoner_level.is_some());
    }
    assert_eq!(remote.calls.load(Ordering::SeqCst), 2);
    remote.raw.lock().await["phase"] = "ReadyCheck".into();
    let ready = service.refresh_live().await.unwrap();
    assert_eq!(ready.generation, party.generation);
    for seat in &ready.seats {
        service
            .player_profile(PlayerProfileQuery {
                player_key: seat.player.as_ref().unwrap().player_key.clone(),
                queue_id: ready.queue_id,
                champion_id: None,
            })
            .await
            .unwrap();
    }
    assert_eq!(remote.calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn late_live_and_search_responses_are_rejected_after_account_switch() {
    let root = tempfile::tempdir().unwrap();
    let (s, r) = setup(root.path()).await;
    let gate = Arc::new(ResponseGate::default());
    *r.response_gate.lock().await = Some(gate.clone());
    let s2 = s.clone();
    let pending = tokio::spawn(async move { s2.refresh_live().await });
    tokio::time::timeout(std::time::Duration::from_secs(5), gate.started.notified())
        .await
        .unwrap();
    s.set_connection(connection("NA1"), Some(r.clone()))
        .await
        .unwrap();
    gate.release.notify_one();
    assert_eq!(
        pending.await.unwrap().unwrap_err().code,
        ErrorCode::SessionChanged
    );
    assert!(s.live_snapshot().await.unwrap().seats.is_empty());
    let s2 = s.clone();
    let pending = tokio::spawn(async move {
        s2.search_player(PlayerSearch {
            query: "Alice#TEST".into(),
        })
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), gate.started.notified())
        .await
        .unwrap();
    s.set_connection(connection("TENCENT_HN1"), Some(r))
        .await
        .unwrap();
    gate.release.notify_one();
    assert_eq!(
        pending.await.unwrap().unwrap_err().code,
        ErrorCode::SessionChanged
    );
    assert!(
        !storage::players(&s.pool)
            .await
            .unwrap()
            .iter()
            .any(|p| p.puuid == "searched-player")
    );
}
#[tokio::test]
async fn live_disconnect_preserves_stale_and_reconnect_reconciles() {
    let root = tempfile::tempdir().unwrap();
    let (s, r) = setup(root.path()).await;
    let a = s.refresh_live().await.unwrap();
    s.set_connection(ConnectionState::default(), None)
        .await
        .unwrap();
    let stale = s.live_snapshot().await.unwrap();
    assert!(stale.stale);
    assert_eq!(stale.seats.len(), 10);
    s.set_connection(connection("TENCENT_HN1"), Some(r))
        .await
        .unwrap();
    let b = s.refresh_live().await.unwrap();
    assert_ne!(a.session_epoch, b.session_epoch);
    assert_ne!(a.generation, b.generation);
    assert!(!b.stale);
}
#[tokio::test]
async fn profiles_dedupe_champion_changes_and_enforce_regions_errors() {
    let root = tempfile::tempdir().unwrap();
    let (s, r) = setup(root.path()).await;
    s.refresh_live().await.unwrap();
    let q = PlayerProfileQuery {
        player_key: filter().player_key,
        queue_id: Some(420),
        champion_id: Some(103),
    };
    let (a, b) = tokio::join!(
        s.player_profile(q.clone()),
        s.player_profile(PlayerProfileQuery {
            champion_id: Some(64),
            ..q.clone()
        })
    );
    assert!(a.unwrap().games <= 50);
    assert!(b.is_ok());
    assert_eq!(r.calls.load(Ordering::SeqCst), 1);
    let foreign = clients::synthetic_player("NA1");
    storage::save_player(&s.pool, &foreign).await.unwrap();
    assert_eq!(
        s.player_profile(PlayerProfileQuery {
            player_key: foreign.player_key,
            queue_id: None,
            champion_id: None
        })
        .await
        .unwrap_err()
        .code,
        ErrorCode::RegionConflict
    );
    r.status.store(429, Ordering::SeqCst);
    assert_eq!(
        s.player_profile(PlayerProfileQuery {
            queue_id: Some(450),
            ..q.clone()
        })
        .await
        .unwrap_err()
        .code,
        ErrorCode::RateLimited
    );
    assert_eq!(
        s.connection.read().await.phase,
        ConnectionPhase::CoolingDown
    );
}
#[tokio::test]
async fn favorites_rename_remove_restart_and_backup_preserve_cache() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let p = s
        .search_player(PlayerSearch {
            query: "Alice#TEST".into(),
        })
        .await
        .unwrap();
    let epoch = s.state.read().await.workspace_epoch.clone();
    for _ in 0..2 {
        s.set_favorite(FavoriteChange {
            workspace_epoch: epoch.clone(),
            player_key: p.player_key.clone(),
            favorite: true,
        })
        .await
        .unwrap();
    }
    let mut renamed = p.clone();
    renamed.display_name = "New name".into();
    storage::save_player(&s.pool, &renamed).await.unwrap();
    assert_eq!(s.favorites().await.unwrap().len(), 1);
    assert_eq!(s.favorites().await.unwrap()[0].display_name, "New name");
    s.player_profile(PlayerProfileQuery {
        player_key: p.player_key.clone(),
        queue_id: None,
        champion_id: None,
    })
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM player_profiles")
            .fetch_one(&s.pool)
            .await
            .unwrap(),
        0
    );
    s.player_profile(PlayerProfileQuery {
        player_key: filter().player_key,
        queue_id: None,
        champion_id: None,
    })
    .await
    .unwrap();
    let backup = s.backup().await.unwrap();
    sqlx::query(
        "UPDATE player_profiles SET payload=json_set(payload,'$.player.playerKey','NA1:other')",
    )
    .execute(&s.pool)
    .await
    .unwrap();
    let corrupt = s.backup().await.unwrap();
    assert_eq!(
        s.restore(&corrupt.reference).await.unwrap_err().code,
        ErrorCode::BackupInvalid
    );

    s.set_favorite(FavoriteChange {
        workspace_epoch: epoch.clone(),
        player_key: p.player_key.clone(),
        favorite: false,
    })
    .await
    .unwrap();
    assert!(s.favorites().await.unwrap().is_empty());
    assert!(
        storage::players(&s.pool)
            .await
            .unwrap()
            .iter()
            .any(|x| x.player_key == p.player_key)
    );
    s.restore(&backup.reference).await.unwrap();
    assert_eq!(s.favorites().await.unwrap().len(), 1);
    assert!(s.live_snapshot().await.unwrap().stale);
    assert_eq!(
        s.set_favorite(FavoriteChange {
            workspace_epoch: epoch,
            player_key: p.player_key,
            favorite: false
        })
        .await
        .unwrap_err()
        .code,
        ErrorCode::SessionChanged
    );
    s.pool.close().await;
    drop(s);
    let (s, _) = setup(root.path()).await;
    assert_eq!(s.favorites().await.unwrap().len(), 1);
}
#[tokio::test]
async fn champion_pool_denominators_filters_missing_details_and_zero_deaths() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    seed(&s, "one", Outcome::Win, Some(2), true).await;
    seed(&s, "two", Outcome::Loss, Some(0), false).await;
    seed(&s, "three", Outcome::Remake, Some(2), true).await;
    seed(&s, "four", Outcome::Unknown, None, false).await;
    let pool = s
        .champion_pool(ChampionQuery {
            filter: filter(),
            queue_ids: None,
            sort: "games".into(),
            cursor: None,
            limit: None,
        })
        .await
        .unwrap();
    let c = &pool.items[0];
    assert_eq!(c.games, 3);
    assert_eq!(pool.filtered_matches, 3);
    assert_eq!(c.trend.len(), 3);
    assert!(
        c.trend
            .iter()
            .all(|match_result| match_result.outcome != Outcome::Remake)
    );
    assert_eq!(c.win_rate.value, Some(0.5));
    assert_eq!(c.win_rate.samples, 2);
    assert_eq!(c.kda.samples, 1);
    assert_eq!(c.kda.excluded["zero_denominator"], 1);
    assert!(!c.win_rate.excluded.contains_key("remake"));
    assert!(!c.kda.excluded.contains_key("remake"));
    assert_eq!(c.damage_share.samples, 3);
    let mut f = filter();
    f.position = Some("UNKNOWN".into());
    assert!(
        s.champion_pool(ChampionQuery {
            filter: f,
            queue_ids: None,
            sort: "games".into(),
            cursor: None,
            limit: None
        })
        .await
        .unwrap()
        .items
        .is_empty()
    );
    assert_eq!(sample([None, None]).value, None);
}
#[tokio::test]
async fn champion_pool_defaults_to_solo_queue_and_unions_selected_modes_without_remakes() {
    let root = tempfile::tempdir().unwrap();
    let (service, _) = setup(root.path()).await;
    for (match_id, queue_id, outcome, champion_id) in [
        ("solo", 420, Outcome::Win, 103),
        ("flex", 440, Outcome::Loss, 103),
        ("normal", 430, Outcome::Win, 103),
        ("aram", 450, Outcome::Loss, 103),
        ("mayhem", 2400, Outcome::Win, 103),
        ("remake", 420, Outcome::Remake, 103),
        ("remake-only-champion", 2400, Outcome::Remake, 157),
    ] {
        let (mut summary, _, _) = seed(&service, match_id, outcome, Some(2), false).await;
        summary.queue_id = Some(queue_id);
        summary.champion_id = Some(champion_id);
        sqlx::query(
            "UPDATE match_participants SET projection=? WHERE match_key=? AND player_key=?",
        )
        .bind(serde_json::to_string(&summary).unwrap())
        .bind(&summary.match_key)
        .bind(&summary.player_key)
        .execute(&service.pool)
        .await
        .unwrap();
    }
    let query = |queue_ids| ChampionQuery {
        filter: filter(),
        queue_ids,
        sort: "games".into(),
        cursor: None,
        limit: None,
    };
    let solo = service.champion_pool(query(None)).await.unwrap();
    assert_eq!(solo.filtered_matches, 1);
    assert_eq!(solo.items[0].games, 1);
    assert_eq!(solo.items[0].win_rate.value, Some(1.0));
    assert_eq!(solo.items[0].win_rate.samples, 1);
    assert_eq!(solo.items[0].kda.samples, 1);
    let aram = service
        .champion_pool(query(Some(vec![450, 2400, 450])))
        .await
        .unwrap();
    assert_eq!(aram.filtered_matches, 2);
    assert_eq!(aram.items.len(), 1);
    assert_eq!(aram.items[0].games, 2);
    assert_eq!(aram.items[0].win_rate.value, Some(0.5));
    assert_eq!(aram.items[0].win_rate.samples, 2);
    assert_eq!(aram.items[0].trend.len(), 2);
    assert!(
        aram.items[0]
            .trend
            .iter()
            .all(|entry| entry.outcome != Outcome::Remake)
    );
    let all = service.champion_pool(query(Some(vec![]))).await.unwrap();
    assert_eq!(all.filtered_matches, 5);
    assert_eq!(all.items.len(), 1);
    assert_eq!(all.items[0].games, 5);
    let mut legacy = query(None);
    legacy.filter.queue_id = Some(440);
    assert_eq!(
        service.champion_pool(legacy).await.unwrap().items[0].games,
        1
    );
    for invalid in [vec![0], vec![1_000_000], vec![420; 33]] {
        assert_eq!(
            service
                .champion_pool(query(Some(invalid)))
                .await
                .unwrap_err()
                .code,
            ErrorCode::InvalidInput
        );
    }
}

#[test]
fn new_rules_use_strict_time_window_and_no_causation() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/review/sgp.json")).unwrap();
    let p = clients::synthetic_player("TENCENT_HN1");
    let m = clients::normalize(
        &json!({"games":[f["summary"].clone()]}),
        &p,
        Source::Sgp,
        None,
    )
    .unwrap()
    .remove(0);
    let mut i = analysis::normalize(&f["summary"], Some(&f["timeline"]), &m, &p.puuid).unwrap();
    let death = i
        .events
        .iter()
        .find(|e| e.victim_id == Some(i.context.target_id))
        .unwrap()
        .clone();
    let mut obj = i
        .events
        .iter()
        .find(|e| e.kind == "ELITE_MONSTER_KILL")
        .unwrap()
        .clone();
    obj.timestamp_ms = death.timestamp_ms + 60000;
    i.events = vec![death.clone(), obj.clone()];
    assert_eq!(analysis::deaths_before_objective(&i).len(), 1);
    obj.timestamp_ms += 1;
    i.events = vec![death.clone(), obj.clone()];
    assert!(analysis::deaths_before_objective(&i).is_empty());
    obj.timestamp_ms = death.timestamp_ms;
    i.events = vec![death, obj];
    assert!(analysis::deaths_before_objective(&i).is_empty());
}
#[tokio::test]
async fn comparison_pins_revisions_and_independent_missing_sides() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let (a, i, r) = seed(&s, "one", Outcome::Win, Some(2), true).await;
    let (b, _, _) = seed(&s, "two", Outcome::Loss, Some(0), false).await;
    let side = |m: &MatchSummary| CompareSide {
        match_key: m.match_key.clone(),
        player_key: m.player_key.clone(),
        input_revision: None,
        report_id: None,
    };
    let mut left = side(&a);
    left.report_id = Some(r.id.clone());
    left.input_revision = Some(i.revision);
    let mut right = side(&b);
    right.report_id = Some("none".into());
    right.input_revision = Some(0);
    let without_report = s
        .compare_matches(CompareQuery {
            left: CompareSide {
                report_id: Some("none".into()),
                ..left.clone()
            },
            right: right.clone(),
        })
        .await
        .unwrap();
    assert_eq!(
        without_report
            .metrics
            .iter()
            .find(|m| m.id == "gold_diff_10")
            .unwrap()
            .left,
        Some(200.)
    );
    let c = s
        .compare_matches(CompareQuery {
            left: left.clone(),
            right,
        })
        .await
        .unwrap();
    assert_eq!(c.left.report.unwrap().id, r.id);
    assert!(c.right.report.is_none());
    assert!(c.right.input.is_none());
    assert!(c.metrics.iter().any(|m| m.id == "kda" && m.delta.is_none()));
    assert_eq!(
        s.compare_matches(CompareQuery {
            left: left.clone(),
            right: left
        })
        .await
        .unwrap_err()
        .code,
        ErrorCode::InvalidInput
    );
}
#[tokio::test]
async fn issue_denominators_report_dedup_versions_and_goal_sources() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    for n in 0..6 {
        seed(&s, &format!("issue-{n}"), Outcome::Win, Some(2), n != 5).await;
    }
    let issues = s
        .issue_summary(IssueQuery {
            filter: filter(),
            cursor: None,
            limit: None,
        })
        .await
        .unwrap();
    assert_eq!(issues.reports, 6);
    let g = issues
        .items
        .iter()
        .find(|g| g.rule_id == "death_before_objective")
        .unwrap();
    assert_eq!(g.eligible, 5);
    assert!(!g.insufficient);
    let missing = g.excluded.values().sum::<u32>();
    assert_eq!(missing, 1);
    let gold = issues
        .items
        .iter()
        .find(|g| g.rule_id == "gold_deficit_10")
        .unwrap();
    assert_eq!(gold.hits, 0);
    assert_eq!(gold.rate, Some(0.));
    let mut f = filter();
    f.queue_id = Some(420);
    f.position = Some("MIDDLE".into());
    f.patch = Some("16.20".into());
    if let Some(g) = issues.items.iter().find(|g| g.hits > 0) {
        let scope = GoalScope {
            champion_id: None,
            player_key: f.player_key.clone(),
            queue_id: 420,
            position: "MIDDLE".into(),
            patch: "16.20".into(),
            metric_id: g.rule_id.clone(),
            metric_version: g.rule_version.clone(),
            direction: "decrease".into(),
            target: 0.2,
            origin: Some(GoalOrigin {
                filter: f,
                rule_id: g.rule_id.clone(),
                rule_version: g.rule_version.clone(),
                reports: g.reports.clone(),
            }),
        };
        let goal = s
            .save_goal(SaveGoal {
                workspace_epoch: s.state.read().await.workspace_epoch.clone(),
                id: None,
                expected_revision: 0,
                scope,
                state: GoalState::Draft,
            })
            .await
            .unwrap();
        assert_eq!(goal.state, GoalState::Draft);
        assert!(goal.scope.origin.is_some());
        let backup = s.backup().await.unwrap();
        s.restore(&backup.reference).await.unwrap();
    }
}
#[tokio::test]
async fn v2_migration_and_backup_upgrade() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("old.db");
    let pool = storage::connect(&path).await.unwrap();
    sqlx::raw_sql(storage::MIGRATION)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(storage::MIGRATION2)
        .execute(&pool)
        .await
        .unwrap();
    let player = clients::synthetic_player("TENCENT_HN1");
    sqlx::query("INSERT INTO players VALUES(?,?,?,?,?)")
        .bind(&player.player_key)
        .bind(&player.server_id)
        .bind(&player.puuid)
        .bind(&player.display_name)
        .bind(&player.updated_at)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let pool = storage::open(&path).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap(),
        i64::from(storage::DATABASE_VERSION)
    );
    assert!(
        sqlx::query("SELECT * FROM favorites")
            .fetch_all(&pool)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(storage::players(&pool).await.unwrap().len(), 1);
}
#[tokio::test]
async fn local_aggregates_performance_records_scale() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    for n in 0..40 {
        seed(&s, &format!("perf-{n}"), Outcome::Win, Some(2), true).await;
    }
    let player = clients::synthetic_player("TENCENT_HN1");
    let base = clients::normalize(
        &clients::synthetic_page(&player, 0),
        &player,
        Source::Sgp,
        None,
    )
    .unwrap()
    .remove(0);
    let task = Task {
        id: "perf-seed".into(),
        player_key: Some(player.player_key.clone()),
        kind: JobKind::Sync,
        state: JobState::Completed,
        checkpoint: 1,
        budget: 1,
        session_epoch: "perf".into(),
        updated_at: storage::now(),
        error: None,
        result: None,
        stage: None,
        retry_at: None,
    };
    for chunk in 0..100 {
        let rows: Vec<_> = (0..100)
            .map(|n| {
                let mut m = base.clone();
                m.game_id = format!("bulk-{}", chunk * 100 + n);
                m.match_key = format!("{}:{}", player.server_id, m.game_id);
                m
            })
            .collect();
        storage::commit_page(&s.pool, &task, &rows, &json!({"batch":chunk}), false)
            .await
            .unwrap();
    }
    let mut hero = Vec::new();
    let mut issue = Vec::new();
    for _ in 0..20 {
        let start = Instant::now();
        s.champion_pool(ChampionQuery {
            filter: filter(),
            queue_ids: None,
            sort: "games".into(),
            cursor: None,
            limit: None,
        })
        .await
        .unwrap();
        hero.push(start.elapsed().as_secs_f64() * 1000.);
        let start = Instant::now();
        s.issue_summary(IssueQuery {
            filter: filter(),
            cursor: None,
            limit: None,
        })
        .await
        .unwrap();
        issue.push(start.elapsed().as_secs_f64() * 1000.);
    }
    hero.sort_by(f64::total_cmp);
    issue.sort_by(f64::total_cmp);
    if let Ok(path) = std::env::var("RIFTMIND_SCOUTING_PERF_REPORT") {
        tokio::fs::write(format!("{path}-aggregates.json"),serde_json::to_vec(&json!({"matches":10040,"reports":40,"iterations":20,"championP95Ms":hero[18],"issuesP95Ms":issue[18]})).unwrap()).await.unwrap();
    }
    println!(
        "SCOUTING_PERF {}",
        json!({"matches":10040,"reports":40,"iterations":20,"championP95Ms":hero[18],"issuesP95Ms":issue[18]})
    );
    assert!(hero[18] < 1000.);
    assert!(issue[18] < 1000.);
}
#[tokio::test]
async fn independent_lcu_http_and_websocket_initial_snapshot_event_reconciliation() {
    use axum::{
        Json, Router,
        extract::{OriginalUri, State, WebSocketUpgrade},
        response::IntoResponse,
        routing::get,
    };
    use futures_util::StreamExt;
    #[derive(Clone)]
    struct StateData {
        raw: Arc<Mutex<Value>>,
        paths: Arc<Mutex<Vec<String>>>,
    }
    async fn endpoint(
        State(s): State<StateData>,
        uri: OriginalUri,
        headers: axum::http::HeaderMap,
    ) -> impl IntoResponse {
        assert_eq!(
            headers.get("authorization").unwrap(),
            "Basic cmlvdDpzeW50aGV0aWMtbGN1"
        );
        s.paths.lock().await.push(uri.path().into());
        let r = s.raw.lock().await;
        Json(match uri.path() {
            "/lol-gameflow/v1/gameflow-phase" => r["phase"].clone(),
            "/lol-gameflow/v1/session" => r["game"].clone(),
            "/lol-champ-select/v1/session" => r["champSelect"].clone(),
            "/lol-lobby/v2/lobby" => r["lobby"].clone(),
            _ => json!({}),
        })
    }
    async fn ws(ws: WebSocketUpgrade) -> impl IntoResponse {
        ws.on_upgrade(|mut socket|async move{let first=socket.recv().await.unwrap().unwrap();assert_eq!(first.to_text().unwrap(),"[5,\"OnJsonApiEvent\"]");socket.send(axum::extract::ws::Message::Text("[8,\"OnJsonApiEvent\",{\"uri\":\"/lol-champ-select/v1/session\",\"eventType\":\"Update\"}]".into())).await.unwrap();let _=socket.recv().await;})
    }
    let data = StateData {
        raw: Arc::new(Mutex::new(live())),
        paths: Arc::new(Mutex::new(vec![])),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = Router::new()
        .route("/", get(ws))
        .fallback(get(endpoint))
        .with_state(data.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let lcu = clients::LcuClient::for_test(port).unwrap();
    let mut socket = lcu.subscribe().await.unwrap();
    let remote = Arc::new(clients::HttpRemote::new(
        Some(lcu),
        domain::servers()
            .into_iter()
            .find(|s| s.id == "TENCENT_HN1")
            .unwrap(),
        clients::Tokens::default(),
    ));
    let mut c = connection("TENCENT_HN1");
    c.lcu_ready = true;
    s.set_connection(c, Some(remote)).await.unwrap();
    let first = s.refresh_live().await.unwrap();
    assert_eq!(first.seats.len(), 10);
    assert!(socket.next().await.unwrap().unwrap().is_text());
    data.raw.lock().await["champSelect"]["myTeam"][0]["championId"] = 64.into();
    let next = s.refresh_live().await.unwrap();
    assert_eq!(next.generation, first.generation);
    assert_eq!(next.seats[0].champion_id, Some(64));
    assert!(next.revision > first.revision);
    {
        let mut raw = data.raw.lock().await;
        raw["phase"] = "Lobby".into();
        raw["lobby"] =
            serde_json::from_str(include_str!("../../../tests/fixtures/scouting/lobby.json"))
                .unwrap();
    }
    let party = s.refresh_live().await.unwrap();
    assert_eq!(party.phase, "Lobby");
    assert_eq!(party.seats.len(), 2);
    assert!(party.seats[0].current);
    assert_eq!(
        party.seats[1].player.as_ref().unwrap().display_name,
        "Party Friend#TEST"
    );
    assert!(party.seats.iter().all(|seat| seat.champion_id.is_none()));
    let paths = data.paths.lock().await;
    assert!(paths.iter().all(|p| p.starts_with("/lol-gameflow/")
        || p == "/lol-champ-select/v1/session"
        || p == "/lol-lobby/v2/lobby"));
    assert_eq!(
        paths
            .iter()
            .filter(|p| p.as_str() == "/lol-gameflow/v1/gameflow-phase")
            .count(),
        6
    );
    drop(paths);
    server.abort();
}
#[tokio::test]
async fn issue_summary_selects_one_report_revision_and_separates_semantic_versions() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let (_, i, old) = seed(&s, "upgraded", Outcome::Win, Some(2), true).await;
    let mut next = old.clone();
    next.id = "upgraded-report".into();
    next.revision = 2;
    next.rule_version = "future-synthetic".into();
    next.metrics
        .iter_mut()
        .find(|m| m.id == "gold_deficit_10")
        .unwrap()
        .version = "2".into();
    sqlx::query("INSERT INTO reviews VALUES(?,?,?,?,?,?,?)")
        .bind(&next.id)
        .bind(&next.match_key)
        .bind(&next.player_key)
        .bind(&i.id)
        .bind(next.revision)
        .bind(&next.rule_version)
        .bind(serde_json::to_string(&next).unwrap())
        .execute(&s.pool)
        .await
        .unwrap();
    let issues = s
        .issue_summary(IssueQuery {
            filter: filter(),
            cursor: None,
            limit: None,
        })
        .await
        .unwrap();
    assert_eq!(issues.reports, 1);
    let gold = issues
        .items
        .iter()
        .find(|g| g.rule_id == "gold_deficit_10")
        .unwrap();
    assert_eq!(gold.rule_version, "2");
    assert_eq!(gold.eligible, 1);
    assert!(gold.metric_id.is_none());
    let death = issues
        .items
        .iter()
        .find(|g| g.rule_id == "death_before_objective")
        .unwrap();
    assert_eq!(death.hits, 1);
    assert_eq!(death.reports.len(), 1);
    assert_eq!(death.reports[0].report_id, next.id);
}
#[tokio::test]
async fn slow_profile_does_not_hold_other_players_behind_one_network_request() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let mut slow = clients::synthetic_player("TENCENT_HN1");
    slow.puuid = "slow-player".into();
    slow.player_key = format!("{}:{}", slow.server_id, slow.puuid);
    storage::save_player(&s.pool, &slow).await.unwrap();
    let service = s.clone();
    let pending = tokio::spawn(async move {
        service
            .player_profile(PlayerProfileQuery {
                player_key: slow.player_key,
                queue_id: None,
                champion_id: None,
            })
            .await
    });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    let fast = tokio::time::timeout(
        std::time::Duration::from_millis(80),
        s.player_profile(PlayerProfileQuery {
            player_key: filter().player_key,
            queue_id: None,
            champion_id: None,
        }),
    )
    .await;
    assert!(fast.unwrap().is_ok());
    assert!(pending.await.unwrap().is_ok());
}
#[tokio::test]
async fn queued_profile_requests_keep_the_workspace_epoch_from_submission() {
    let root = tempfile::tempdir().unwrap();
    let (s, r) = setup(root.path()).await;
    r.delay.store(100, Ordering::SeqCst);
    let service = s.clone();
    let request = PlayerProfileQuery {
        player_key: filter().player_key,
        queue_id: None,
        champion_id: None,
    };
    let first = request.clone();
    let a = tokio::spawn(async move { service.player_profile(first).await });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    let service = s.clone();
    let b = tokio::spawn(async move { service.player_profile(request).await });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    s.state.write().await.workspace_epoch = "restored-workspace".into();
    assert_eq!(
        a.await.unwrap().unwrap_err().code,
        ErrorCode::SessionChanged
    );
    assert_eq!(
        b.await.unwrap().unwrap_err().code,
        ErrorCode::SessionChanged
    );
    assert_eq!(r.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM player_profiles")
            .fetch_one(&s.pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn visitor_overviews_fetch_only_fifty_without_persisting_or_reusing_profiles() {
    let root = tempfile::tempdir().unwrap();
    let (service, remote) = setup(root.path()).await;
    let visitor = service
        .search_player(PlayerSearch {
            query: "Visitor#TEST".into(),
        })
        .await
        .unwrap();
    let query = PlayerOverviewQuery {
        player_key: visitor.player_key.clone(),
        queue_id: None,
        days: Some(30),
    };
    for _ in 0..2 {
        let overview = service.player_overview(query.clone()).await.unwrap();
        assert!(!overview.is_self);
        assert_eq!(overview.matches.len(), 50);
        assert_eq!(overview.profile.games, 50);
        assert!(overview.rank_history.is_empty());
    }
    assert_eq!(remote.calls.load(Ordering::SeqCst), 2);
    for table in [
        "player_profiles",
        "rank_snapshots",
        "match_participants",
        "source_snapshots",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&service.pool)
                .await
                .unwrap(),
            0
        );
    }
    assert_eq!(
        service
            .start_sync(SyncRequest {
                player_key: visitor.player_key.clone(),
                pages: 1
            })
            .await
            .unwrap_err()
            .code,
        ErrorCode::Forbidden
    );
    let mut offline = service.connection.read().await.clone();
    offline.phase = ConnectionPhase::Disconnected;
    service.set_connection(offline, None).await.unwrap();
    assert_eq!(
        service.player_overview(query).await.unwrap_err().code,
        ErrorCode::ClientNotFound
    );
}

#[tokio::test]
async fn personal_overviews_merge_saved_history_and_preserve_rank_observations_offline() {
    let root = tempfile::tempdir().unwrap();
    let (service, remote) = setup(root.path()).await;
    let player = clients::synthetic_player("TENCENT_HN1");
    let task = Task {
        id: "personal-history".into(),
        player_key: Some(player.player_key.clone()),
        kind: JobKind::Sync,
        state: JobState::Completed,
        checkpoint: 1,
        budget: 3,
        session_epoch: "seed".into(),
        updated_at: storage::now(),
        error: None,
        result: None,
        stage: None,
        retry_at: None,
    };
    for offset in [0, 50, 100] {
        let raw = clients::synthetic_page(&player, offset);
        let summaries = clients::normalize(&raw, &player, Source::Sgp, None).unwrap();
        storage::commit_page(&service.pool, &task, &summaries, &raw, false)
            .await
            .unwrap();
    }
    *remote.ranks.lock().await = json!({"queues":[{"queueType":"RANKED_SOLO_5x5","tier":"GOLD","division":"II","leaguePoints":42}]});
    let query = PlayerOverviewQuery {
        player_key: player.player_key.clone(),
        queue_id: None,
        days: None,
    };
    let first = service.player_overview(query.clone()).await.unwrap();
    assert!(first.is_self);
    assert_eq!(first.matches.len(), 125);
    assert_eq!(first.profile.games, 125);
    assert_eq!(first.rank_history.len(), 1);
    assert_eq!(
        service
            .player_overview(query.clone())
            .await
            .unwrap()
            .rank_history
            .len(),
        1
    );
    remote.ranks.lock().await["queues"][0]["leaguePoints"] = 65.into();
    let changed = service.player_overview(query.clone()).await.unwrap();
    assert_eq!(changed.rank_history.len(), 2);
    let mut offline = service.connection.read().await.clone();
    offline.phase = ConnectionPhase::Disconnected;
    offline.player = None;
    service.set_connection(offline, None).await.unwrap();
    let saved = service.player_overview(query).await.unwrap();
    assert!(saved.is_self);
    assert_eq!(saved.matches.len(), 125);
    assert_eq!(saved.rank_history.len(), 2);
    assert_eq!(saved.profile.ranks[0].points, Some(65));
    assert_eq!(
        service
            .player_overview(PlayerOverviewQuery {
                player_key: player.player_key,
                queue_id: Some(420),
                days: None
            })
            .await
            .unwrap()
            .matches
            .len(),
        83
    );
}
