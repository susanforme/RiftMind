use async_trait::async_trait;
use riftmind_core::{
    clients::{self, MatchRemote},
    contracts::*,
    domain::{self, analysis},
    services::Service,
    settings::JsonSettingsStore,
    storage::{self, review as db},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
};
fn fixture(source: &str) -> Value {
    serde_json::from_str(if source == "sgp" {
        include_str!("../../../tests/fixtures/review/sgp.json")
    } else {
        include_str!("../../../tests/fixtures/review/lcu.json")
    })
    .unwrap()
}
fn match_summary(raw: &Value) -> MatchSummary {
    clients::normalize(
        &json!({"games":[raw["summary"].clone()]}),
        &clients::synthetic_player("TENCENT_HN1"),
        Source::Sgp,
        None,
    )
    .unwrap()
    .remove(0)
}
fn input() -> AnalysisInput {
    let f = fixture("sgp");
    let mut i = analysis::normalize(
        &f["summary"],
        Some(&f["timeline"]),
        &match_summary(&f),
        "synthetic-player",
    )
    .unwrap();
    i.summary_snapshot = "summary".into();
    i.timeline_snapshot = Some("timeline".into());
    i.fingerprint = "fixed".into();
    i.revision = 1;
    i
}
fn key() -> MatchRef {
    MatchRef {
        match_key: "TENCENT_HN1:900719925474101".into(),
        player_key: "TENCENT_HN1:synthetic-player".into(),
    }
}
fn metric_value(m: &[MetricResult], id: &str) -> Option<f64> {
    m.iter().find(|m| m.id == id).unwrap().value
}
#[test]
fn sgp_and_lcu_converters_validate_mapping_frames_and_stable_events() {
    for source in ["sgp", "lcu"] {
        let raw = fixture(source);
        let i = analysis::normalize(
            &raw["summary"],
            Some(&raw["timeline"]),
            &match_summary(&raw),
            "synthetic-player",
        )
        .unwrap();
        assert_eq!(i.context.target_id, 3);
        assert_eq!(i.context.participants.len(), 10);
        assert_eq!(i.frames.len(), 310);
        assert_eq!(i.events.len(), 8);
        assert_eq!(
            i.events.iter().filter(|e| e.timestamp_ms == 120000).count(),
            4
        );
        assert_eq!(i.events[1].undo_of.as_deref(), Some("event-2-0"));
        assert_eq!(i.events.last().unwrap().raw["unknown"]["kept"], true);
        assert_eq!(i.capabilities["timeline"].status, DataStatus::Ready);
        assert_eq!(
            i.frames
                .iter()
                .find(|f| f.participant_id == 3 && f.timestamp_ms == 600000)
                .unwrap()
                .cs,
            Some(70)
        );
    }
}
#[test]
fn converters_reject_cross_match_bad_mapping_and_bad_time_without_losing_unknowns() {
    let f = fixture("sgp");
    let m = match_summary(&f);
    for mutation in 0..5 {
        let mut t = f["timeline"].clone();
        match mutation {
            0 => t["json"]["gameId"] = "other".into(),
            1 => t["json"]["frames"][1]["participantFrames"]["3"]["participantId"] = 7.into(),
            2 => t["json"]["frames"][1]["timestamp"] = (-1).into(),
            3 => t["json"]["frames"][1]["timestamp"] = 1800000000u32.into(),
            _ => t["json"]["participants"][2]["puuid"] = "wrong".into(),
        };
        assert!(analysis::normalize(&f["summary"], Some(&t), &m, "synthetic-player").is_err());
    }
    let mut t = f["timeline"].clone();
    t["json"]["frames"].as_array_mut().unwrap().remove(10);
    let i = analysis::normalize(&f["summary"], Some(&t), &m, "synthetic-player").unwrap();
    assert_eq!(i.capabilities["timeline"].status, DataStatus::Partial);
    let chart = analysis::chart(&i, 0, 1800000, 1000).unwrap();
    assert!(chart.points.iter().any(|p| p.gold.is_none()));
}
// Metric tests build canonical input independently, rather than using the converter as an oracle.
fn manual_input() -> AnalysisInput {
    let mut parts = Vec::new();
    for id in 1..=10 {
        parts.push(Participant {
            id,
            puuid: None,
            team_id: if id <= 5 { 100 } else { 200 },
            champion_id: Some(103),
            position: Some(
                ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][((id - 1) % 5) as usize].into(),
            ),
            kills: Some(if id == 3 { 8 } else { 3 }),
            deaths: Some(2),
            assists: Some(4),
            lane_cs: Some(160),
            jungle_cs: Some(20),
            damage: Some(if id == 3 { 20000 } else { 10000 }),
            gold: Some(if id == 3 { 12000 } else { 10000 }),
        });
    }
    AnalysisInput {
        id: "manual".into(),
        revision: 1,
        fingerprint: "manual".into(),
        converter_version: analysis::CONVERTER.into(),
        summary_snapshot: "s".into(),
        timeline_snapshot: Some("t".into()),
        context: MatchContext {
            match_key: "NA1:1".into(),
            player_key: "NA1:p".into(),
            target_id: 3,
            participants: parts,
            team_kills: BTreeMap::from([("100".into(), 20)]),
            queue_id: Some(420),
            map_id: Some(11),
            mode: Some("CLASSIC".into()),
            version: "16.20.1".into(),
            duration_ms: 1800000,
            started_at: "2026-10-01T00:00:00.000Z".into(),
            remake: false,
            source: Source::Sgp,
        },
        capabilities: BTreeMap::new(),
        frames: vec![
            FramePoint {
                timestamp_ms: 570000,
                participant_id: 3,
                gold: Some(3500),
                cs: Some(70),
                xp: Some(4000),
                path: "/a".into(),
            },
            FramePoint {
                timestamp_ms: 570000,
                participant_id: 8,
                gold: Some(3300),
                cs: Some(60),
                xp: Some(3900),
                path: "/b".into(),
            },
        ],
        events: vec![],
        limitations: vec![],
    }
}
#[test]
fn independent_manual_metrics_match_fixed_definitions_and_missingness() {
    let mut i = manual_input();
    let m = analysis::metrics(&i);
    for (id, expected) in [
        ("kda", 6.),
        ("total_cs", 180.),
        ("cs_per_min", 6.),
        ("participation", 0.6),
        ("damage_share", 1. / 3.),
        ("gold_share", 12000. / 52000.),
        ("cs_10", 70.),
        ("gold_diff_10", 200.),
        ("xp_diff_10", 100.),
        ("deaths_per_10", 2. / 3.),
    ] {
        assert!(
            (metric_value(&m, id).unwrap() - expected).abs() < 1e-10,
            "{id}"
        );
    }
    assert_eq!(
        m.iter().find(|m| m.id == "cs_10").unwrap().sampled_at_ms,
        Some(570000)
    );
    i.context.participants[2].deaths = Some(0);
    let m = analysis::metrics(&i);
    assert_eq!(metric_value(&m, "kda"), None);
    assert_eq!(
        m.iter().find(|m| m.id == "kda").unwrap().status,
        MetricStatus::NotApplicable
    );
    i.context.participants[0].damage = None;
    i.context.participants[2].jungle_cs = None;
    i.frames[0].timestamp_ms = 539999;
    let m = analysis::metrics(&i);
    assert_eq!(metric_value(&m, "damage_share"), None);
    assert_eq!(metric_value(&m, "cs_per_min"), None);
    assert_eq!(metric_value(&m, "cs_10"), None);
    i.context.duration_ms = 500000;
    assert_eq!(
        analysis::metrics(&i)
            .iter()
            .find(|m| m.id == "cs_10")
            .unwrap()
            .status,
        MetricStatus::NotApplicable
    );
    i.context.duration_ms = 0;
    assert!(
        serde_json::to_string(&analysis::metrics(&i))
            .unwrap()
            .find("Infinity")
            .is_none()
    );
}
#[test]
fn reports_are_deterministic_evidence_belongs_to_input_and_modes_are_gated() {
    let i = input();
    let a = analysis::report(&i).unwrap();
    let b = analysis::report(&i).unwrap();
    assert_eq!(
        serde_json::to_value(&a).unwrap(),
        serde_json::to_value(b).unwrap()
    );
    assert!(a.findings.iter().filter(|f| f.priority > 0).count() <= 3);
    assert!(a.findings.iter().all(|f| !f.evidence_ids.is_empty()));
    let mut bad = a;
    bad.evidence[0].snapshot_id = "wrong".into();
    assert!(analysis::validate_evidence(&i, &bad).is_err());
    let mut i = i;
    i.context.queue_id = Some(450);
    assert_eq!(
        analysis::report(&i).unwrap_err().code,
        ErrorCode::AnalysisUnsupported
    );
}
struct Remote {
    calls: AtomicU32,
    fail: AtomicU32,
    delay: AtomicU32,
}
#[async_trait]
impl MatchRemote for Remote {
    async fn page(&self, _: &Player, _: u32, _: Source) -> Result<Value> {
        Ok(json!({"games":[fixture("sgp")["summary"].clone()]}))
    }
    async fn single(&self, _: &MatchSummary, timeline: bool, _: Source) -> Result<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(std::time::Duration::from_millis(
            self.delay.load(Ordering::SeqCst) as u64,
        ))
        .await;
        if self.fail.load(Ordering::SeqCst) > 0 {
            return Err(AppError::new(ErrorCode::Forbidden));
        }
        Ok(fixture("sgp")[if timeline { "timeline" } else { "summary" }].clone())
    }
}
async fn service(root: &Path) -> Arc<Service> {
    Service::new(
        storage::open(&root.join("riftmind.db")).await.unwrap(),
        root.to_owned(),
        Arc::new(JsonSettingsStore(root.join("settings.json"))),
    )
    .await
    .unwrap()
}
async fn wait(s: &Service, id: &str) -> Task {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let t = storage::task(&s.pool, id).await.unwrap();
            if !matches!(t.state, JobState::Queued | JobState::Running) {
                return t;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await
        }
    })
    .await
    .unwrap()
}
async fn setup(root: &Path) -> (Arc<Service>, Arc<Remote>) {
    let s = service(root).await;
    s.settings.lock().await.auto_sync = false;
    let remote = Arc::new(Remote {
        calls: AtomicU32::new(0),
        fail: AtomicU32::new(0),
        delay: AtomicU32::new(0),
    });
    s.set_connection(
        ConnectionState {
            phase: ConnectionPhase::Connected,
            player: Some(clients::synthetic_player("TENCENT_HN1")),
            identification: Some(domain::identify(Some("TENCENT"), Some("HN1"), None)),
            sgp_ready: true,
            ..ConnectionState::default()
        },
        Some(remote.clone()),
    )
    .await
    .unwrap();
    let t = s
        .start_sync(SyncRequest {
            player_key: key().player_key,
            pages: 1,
        })
        .await
        .unwrap();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Completed);
    (s, remote)
}
async fn make_report(s: &Arc<Service>) -> ReviewReport {
    let t = s.start_details(key()).await.unwrap();
    assert_eq!(wait(s, &t.id).await.state, JobState::Completed);
    let i = db::input(&s.pool, &key(), None).await.unwrap().unwrap();
    let t = s
        .start_review(GenerateReview {
            match_key: key().match_key,
            player_key: key().player_key,
            input_revision: i.revision,
        })
        .await
        .unwrap();
    let result = wait(s, &t.id).await;
    assert_eq!(result.state, JobState::Completed, "{:?}", result.error);
    db::report(&s.pool, &result.result.unwrap().reference)
        .await
        .unwrap()
}
#[tokio::test]
async fn sqlite_details_reports_annotations_restart_backup_and_optimistic_conflicts() {
    let root = tempfile::tempdir().unwrap();
    let (s, remote) = setup(root.path()).await;
    let initial = db::input(&s.pool, &key(), None).await.unwrap().unwrap();
    assert!(initial.timeline_snapshot.is_none());
    let r = make_report(&s).await;
    assert_eq!(
        remote.calls.load(Ordering::SeqCst),
        1,
        "cached full SUMMARY must not be re-fetched"
    );
    let i = db::input(&s.pool, &key(), None).await.unwrap().unwrap();
    assert!(i.revision > initial.revision);
    let n = db::save_note(
        &s.pool,
        SaveNote {
            workspace_epoch: String::new(),
            id: None,
            match_key: key().match_key,
            player_key: key().player_key,
            report_id: Some(r.id.clone()),
            evidence_id: Some(r.evidence[0].id.clone()),
            text: "<script>plain text</script>".into(),
            expected_revision: 0,
        },
    )
    .await
    .unwrap();
    let mut edit = SaveNote {
        workspace_epoch: String::new(),
        id: Some(n.id.clone()),
        match_key: key().match_key,
        player_key: key().player_key,
        report_id: n.report_id.clone(),
        evidence_id: n.evidence_id.clone(),
        text: "edited".into(),
        expected_revision: n.revision,
    };
    let newer = db::save_note(&s.pool, edit.clone()).await.unwrap();
    let err = db::save_note(&s.pool, edit.clone()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::RevisionConflict);
    assert!(err.params["current"].contains("edited"));
    let f = &r.findings[0];
    db::feedback(
        &s.pool,
        SaveFeedback {
            workspace_epoch: String::new(),
            report_id: r.id.clone(),
            finding_id: f.id.clone(),
            value: Some("helpful".into()),
            expected_revision: 0,
        },
    )
    .await
    .unwrap();
    let e = db::evidence(
        &s.pool,
        EvidenceQuery {
            report_id: r.id.clone(),
            evidence_id: f.evidence_ids[0].clone(),
        },
    )
    .await
    .unwrap();
    assert!(!e.raw.is_null());
    assert!(
        db::evidence(
            &s.pool,
            EvidenceQuery {
                report_id: r.id.clone(),
                evidence_id: "../../secret".into()
            }
        )
        .await
        .is_err()
    );
    let backup = s.backup().await.unwrap();
    let epoch = s.state.read().await.workspace_epoch.clone();
    edit.expected_revision = newer.revision;
    edit.text = "after backup".into();
    db::save_note(&s.pool, edit).await.unwrap();
    s.restore(&backup.reference).await.unwrap();
    assert_ne!(epoch, s.state.read().await.workspace_epoch);
    s.dispatch(Command::clear_asset_cache(Empty {}))
        .await
        .unwrap();
    let ann = db::annotations(
        &s.pool,
        AnnotationsQuery {
            match_key: key().match_key,
            player_key: key().player_key,
            report_id: Some(r.id.clone()),
        },
    )
    .await
    .unwrap();
    assert_eq!(ann.notes[0].text, "edited");
    assert_eq!(ann.feedback[0].value.as_deref(), Some("helpful"));
    s.shutdown().await.unwrap();
    let s = service(root.path()).await;
    assert_eq!(
        db::report(&s.pool, &r.id).await.unwrap().input_fingerprint,
        r.input_fingerprint
    );
    let t = s
        .start_review(GenerateReview {
            match_key: key().match_key,
            player_key: key().player_key,
            input_revision: initial.revision,
        })
        .await
        .unwrap();
    let t = wait(&s, &t.id).await;
    assert_eq!(t.state, JobState::Completed);
    assert_eq!(
        db::latest_report(&s.pool, &key())
            .await
            .unwrap()
            .unwrap()
            .id,
        r.id,
        "late old input must not replace current report"
    );
    let ann = db::annotations(
        &s.pool,
        AnnotationsQuery {
            match_key: key().match_key,
            player_key: key().player_key,
            report_id: Some(r.id),
        },
    )
    .await
    .unwrap();
    assert_eq!(ann.notes[0].text, "edited");
    s.shutdown().await.unwrap();
}
#[tokio::test]
async fn failure_cooldown_dedup_cancel_and_session_switch_preserve_valid_inputs() {
    let root = tempfile::tempdir().unwrap();
    let (s, remote) = setup(root.path()).await;
    remote.delay.store(60, Ordering::SeqCst);
    let t = s.start_details(key()).await.unwrap();
    assert_eq!(s.start_details(key()).await.unwrap().id, t.id);
    s.dispatch(Command::cancel_task(IdInput { id: t.id.clone() }))
        .await
        .unwrap();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Cancelled);
    sqlx::query("UPDATE detail_attempts SET retry_at=NULL")
        .execute(&s.pool)
        .await
        .unwrap();
    remote.fail.store(1, Ordering::SeqCst);
    let t = s.start_details(key()).await.unwrap();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Failed);
    assert_eq!(
        s.start_details(key()).await.unwrap_err().code,
        ErrorCode::RateLimited
    );
    assert!(db::input(&s.pool, &key(), None).await.unwrap().is_some());
    sqlx::query("UPDATE detail_attempts SET retry_at=NULL")
        .execute(&s.pool)
        .await
        .unwrap();
    remote.fail.store(0, Ordering::SeqCst);
    let t = s.start_details(key()).await.unwrap();
    s.set_connection(ConnectionState::default(), None)
        .await
        .unwrap();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Cancelled);
    assert!(
        db::input(&s.pool, &key(), None)
            .await
            .unwrap()
            .unwrap()
            .timeline_snapshot
            .is_none()
    );
    s.shutdown().await.unwrap();
}
#[tokio::test]
async fn real_v1_migration_and_v1_backup_upgrade_preserve_data_and_mark_missing() {
    use base64::Engine;
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("riftmind.db");
    let pool = storage::connect(&path).await.unwrap();
    sqlx::raw_sql(storage::MIGRATION)
        .execute(&pool)
        .await
        .unwrap();
    storage::save_player(&pool, &clients::synthetic_player("TENCENT_HN1"))
        .await
        .unwrap();
    let dbpath = root.path().join("old.db");
    storage::vacuum_backup(&pool, &dbpath).await.unwrap();
    pool.close().await;
    let s = service(root.path()).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("PRAGMA user_version")
            .fetch_one(&s.pool)
            .await
            .unwrap(),
        3
    );
    assert_eq!(storage::players(&s.pool).await.unwrap().len(), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM analysis_inputs")
            .fetch_one(&s.pool)
            .await
            .unwrap(),
        0
    );
    let bytes = tokio::fs::read(dbpath).await.unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let bundle = json!({"schemaVersion":1,"database":base64::engine::general_purpose::STANDARD.encode(&bytes),"sha256":storage::hash(&bytes),"settings":Settings::default()});
    tokio::fs::write(
        root.path().join("backups").join(format!("{id}.riftmind")),
        serde_json::to_vec(&bundle).unwrap(),
    )
    .await
    .unwrap();
    s.restore(&id).await.unwrap();
    assert_eq!(storage::players(&s.pool).await.unwrap().len(), 1);
    assert_eq!(s.state.read().await.database_version, 3);
    s.shutdown().await.unwrap();
}
#[tokio::test]
async fn training_uses_fixed_baseline_post_creation_windows_versions_and_exclusions() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let base = make_report(&s).await;
    let base_input = db::input(&s.pool, &key(), None).await.unwrap().unwrap();
    async fn add(
        s: &Service,
        template: &AnalysisInput,
        report: &ReviewReport,
        game: u32,
        started: String,
        remake: bool,
    ) {
        let mut i = template.clone();
        let mut r = report.clone();
        let m0 = db::summary(&s.pool, &key()).await.unwrap();
        let mut m = m0.clone();
        m.match_key = format!("TENCENT_HN1:{game}");
        m.game_id = game.to_string();
        m.started_at = started.clone();
        sqlx::query("INSERT INTO matches VALUES(?,?,?,?,?,?)")
            .bind(&m.match_key)
            .bind(&m.server_id)
            .bind(&m.game_id)
            .bind(&started)
            .bind(420)
            .bind(&m.version)
            .execute(&s.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO match_participants SELECT ?,player_key,champion_id,outcome,kills,deaths,assists,duration,position,cs,items,source,fallback_reason,revision,? FROM match_participants WHERE match_key=? AND player_key=?").bind(&m.match_key).bind(serde_json::to_string(&m).unwrap()).bind(&m0.match_key).bind(&m0.player_key).execute(&s.pool).await.unwrap();
        i.id = uuid::Uuid::new_v4().to_string();
        i.context.match_key = m.match_key.clone();
        i.context.started_at = started;
        i.context.remake = remake;
        i.fingerprint = format!("f{game}");
        i.revision = 1;
        sqlx::query("INSERT INTO analysis_inputs VALUES(?,?,?,?,?,?,?,?)")
            .bind(&i.id)
            .bind(&m.match_key)
            .bind(&m.player_key)
            .bind(1)
            .bind(&i.fingerprint)
            .bind(&i.summary_snapshot)
            .bind(&i.timeline_snapshot)
            .bind(serde_json::to_string(&i).unwrap())
            .execute(&s.pool)
            .await
            .unwrap();
        r.id = uuid::Uuid::new_v4().to_string();
        r.match_key = m.match_key;
        r.input_fingerprint = i.fingerprint;
        r.input_revision = 1;
        r.revision = 1;
        sqlx::query("INSERT INTO reviews VALUES(?,?,?,?,?,?,?)")
            .bind(&r.id)
            .bind(&r.match_key)
            .bind(&r.player_key)
            .bind(&i.id)
            .bind(1)
            .bind(&r.rule_version)
            .bind(serde_json::to_string(&r).unwrap())
            .execute(&s.pool)
            .await
            .unwrap();
    }
    let scope = GoalScope {
        origin: None,
        player_key: key().player_key,
        queue_id: 420,
        position: "MIDDLE".into(),
        patch: "16.20".into(),
        metric_id: "cs_10".into(),
        metric_version: "1".into(),
        direction: "increase".into(),
        target: 65.,
    };
    let draft = s
        .save_goal(SaveGoal {
            workspace_epoch: s.state.read().await.workspace_epoch.clone(),
            id: None,
            expected_revision: 0,
            scope: scope.clone(),
            state: GoalState::Active,
        })
        .await
        .unwrap();
    assert_eq!(draft.state, GoalState::Draft);
    for n in 1..=5 {
        add(
            &s,
            &base_input,
            &base,
            n,
            format!("2026-10-0{n}T00:00:00.000Z"),
            false,
        )
        .await;
    }
    let goal = s
        .save_goal(SaveGoal {
            workspace_epoch: s.state.read().await.workspace_epoch.clone(),
            id: None,
            expected_revision: 0,
            scope: scope.clone(),
            state: GoalState::Active,
        })
        .await
        .unwrap();
    assert_eq!(goal.state, GoalState::Active);
    assert!(goal.baseline.len() >= 5);
    let future = chrono::Utc::now() + chrono::Duration::days(1);
    for n in 10..=14 {
        add(
            &s,
            &base_input,
            &base,
            n,
            (future + chrono::Duration::minutes(n as i64))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            false,
        )
        .await;
    }
    add(
        &s,
        &base_input,
        &base,
        15,
        (future + chrono::Duration::minutes(15))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        true,
    )
    .await;
    let t = s.start_evaluation(&goal.id).await.unwrap();
    assert_eq!(wait(&s, &t.id).await.state, JobState::Completed);
    let p = s
        .goal_progress(GoalProgressQuery {
            goal_id: goal.id.clone(),
            revision: None,
        })
        .await
        .unwrap();
    let e = p.evaluation.unwrap();
    assert_eq!(e.members.len(), 5);
    assert_eq!(e.achieved, Some(true));
    assert_eq!(e.excluded["remake"], 1);
    assert_eq!(e.baseline, Some(70.));
    assert_eq!(
        p.goal.state,
        GoalState::Active,
        "target attainment is not automatic completion"
    );
    let paused = s
        .save_goal(SaveGoal {
            workspace_epoch: s.state.read().await.workspace_epoch.clone(),
            id: Some(goal.id.clone()),
            expected_revision: goal.revision,
            scope: scope.clone(),
            state: GoalState::Paused,
        })
        .await
        .unwrap();
    assert!(s.start_evaluation(&goal.id).await.is_err());
    let resumed = s
        .save_goal(SaveGoal {
            workspace_epoch: s.state.read().await.workspace_epoch.clone(),
            id: Some(goal.id.clone()),
            expected_revision: paused.revision,
            scope: scope.clone(),
            state: GoalState::Active,
        })
        .await
        .unwrap();
    assert!(resumed.window_start > goal.window_start);
    let mut changed = scope;
    changed.target = 80.;
    let new = s
        .save_goal(SaveGoal {
            workspace_epoch: s.state.read().await.workspace_epoch.clone(),
            id: Some(goal.id.clone()),
            expected_revision: resumed.revision,
            scope: changed,
            state: GoalState::Active,
        })
        .await
        .unwrap();
    assert_ne!(new.id, goal.id);
    assert_eq!(
        s.goal_progress(GoalProgressQuery {
            goal_id: goal.id.clone(),
            revision: None
        })
        .await
        .unwrap()
        .goal
        .state,
        GoalState::Paused
    );
    assert_eq!(new.version, 2);
    assert_eq!(new.previous_goal_id, Some(goal.id));
    s.shutdown().await.unwrap();
}
#[test]
fn timeline_chart_budget_keeps_gaps_and_rejects_oversized_queries() {
    let i = input();
    assert!(analysis::chart(&i, 0, 1800000, 1001).is_err());
    assert!(analysis::chart(&i, 100, 0, 100).is_err());
    assert!(analysis::chart(&i, 0, 1800000, 10).unwrap().points.len() <= 10);
}

#[tokio::test]
async fn stale_workspace_writes_and_corrupt_embedded_backup_evidence_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let r = make_report(&s).await;
    let old_epoch = s.state.read().await.workspace_epoch.clone();
    let backup = s.backup().await.unwrap();
    s.restore(&backup.reference).await.unwrap();
    let result = s
        .dispatch(Command::save_review_note(SaveNote {
            workspace_epoch: old_epoch,
            id: None,
            match_key: key().match_key,
            player_key: key().player_key,
            report_id: None,
            evidence_id: None,
            text: "stale draft".into(),
            expected_revision: 0,
        }))
        .await;
    assert_eq!(result.unwrap_err().code, ErrorCode::SessionChanged);
    let mut corrupted = r.clone();
    corrupted.evidence[0].snapshot_id = "wrong-snapshot".into();
    sqlx::query("UPDATE reviews SET payload=? WHERE id=?")
        .bind(serde_json::to_string(&corrupted).unwrap())
        .bind(&r.id)
        .execute(&s.pool)
        .await
        .unwrap();
    let bad = s.backup().await.unwrap();
    assert!(s.restore(&bad.reference).await.is_err());
    s.shutdown().await.unwrap();
}
#[tokio::test]
async fn interrupted_remote_jobs_wait_for_a_revalidated_session_and_resume_same_task() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let id = uuid::Uuid::new_v4().to_string();
    let dedupe = format!("{}|{}|details", key().match_key, key().player_key);
    sqlx::query("INSERT INTO jobs(id,player_key,state,checkpoint,budget,session_epoch,updated_at,kind,dedupe_key,request) VALUES(?,?,'running',0,2,'old-session',?,'fetch_details',?,?)").bind(&id).bind(key().player_key).bind(storage::now()).bind(dedupe).bind(serde_json::to_string(&key()).unwrap()).execute(&s.pool).await.unwrap();
    s.pool.close().await;
    drop(s);
    let s = service(root.path()).await;
    assert_eq!(
        storage::task(&s.pool, &id).await.unwrap().state,
        JobState::Interrupted
    );
    s.settings.lock().await.auto_sync = false;
    let remote = Arc::new(Remote {
        calls: AtomicU32::new(0),
        fail: AtomicU32::new(0),
        delay: AtomicU32::new(0),
    });
    s.set_connection(
        ConnectionState {
            phase: ConnectionPhase::Connected,
            player: Some(clients::synthetic_player("TENCENT_HN1")),
            identification: Some(domain::identify(Some("TENCENT"), Some("HN1"), None)),
            sgp_ready: true,
            ..ConnectionState::default()
        },
        Some(remote.clone()),
    )
    .await
    .unwrap();
    assert_eq!(wait(&s, &id).await.state, JobState::Completed);
    assert_eq!(remote.calls.load(Ordering::SeqCst), 1);
    s.shutdown().await.unwrap();
}
struct FallbackRemote {
    failure: ErrorCode,
    lcu_calls: AtomicU32,
    equivalent: bool,
}
#[async_trait]
impl MatchRemote for FallbackRemote {
    async fn page(&self, _: &Player, _: u32, _: Source) -> Result<Value> {
        unreachable!()
    }
    fn lcu_timeline_equivalent(&self) -> bool {
        self.equivalent
    }
    async fn single(&self, _: &MatchSummary, timeline: bool, source: Source) -> Result<Value> {
        if source == Source::Sgp {
            return Err(AppError::new(self.failure.clone()));
        }
        self.lcu_calls.fetch_add(1, Ordering::SeqCst);
        Ok(fixture("lcu")[if timeline { "timeline" } else { "summary" }].clone())
    }
}
#[tokio::test]
async fn fallback_is_endpoint_specific_and_never_bypasses_forbidden_or_rate_limits() {
    for (failure, equivalent, expected) in [
        (ErrorCode::Forbidden, true, 0),
        (ErrorCode::RateLimited, true, 0),
        (ErrorCode::EndpointUnsupported, false, 0),
        (ErrorCode::EndpointUnsupported, true, 1),
    ] {
        let root = tempfile::tempdir().unwrap();
        let (s, _) = setup(root.path()).await;
        let remote = Arc::new(FallbackRemote {
            failure,
            lcu_calls: AtomicU32::new(0),
            equivalent,
        });
        *s.remote.write().await = Some(remote.clone());
        s.connection.write().await.lcu_ready = true;
        let t = s.start_details(key()).await.unwrap();
        let t = wait(&s, &t.id).await;
        assert_eq!(remote.lcu_calls.load(Ordering::SeqCst), expected);
        assert_eq!(
            t.state,
            if expected == 1 {
                JobState::Completed
            } else {
                JobState::Failed
            }
        );
        s.shutdown().await.unwrap();
    }
}
#[tokio::test]
async fn event_reads_are_bounded_and_registered_unknown_events_remain_locatable() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let r = make_report(&s).await;
    let revision = r.input_revision;
    let slice = s
        .timeline_slice(TimelineQuery {
            match_key: key().match_key,
            player_key: key().player_key,
            input_revision: revision,
            from_ms: 0,
            to_ms: 1800000,
            kinds: vec![],
            cursor: None,
            limit: Some(3),
        })
        .await
        .unwrap();
    assert_eq!(slice.events.len(), 3);
    assert_eq!(slice.next_cursor, Some(3));
    let event = db::evidence(
        &s.pool,
        EvidenceQuery {
            report_id: r.id,
            evidence_id: "event-10-0".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(event.raw["unknown"]["kept"], true);
    assert!(
        s.timeline_slice(TimelineQuery {
            match_key: key().match_key,
            player_key: key().player_key,
            input_revision: revision,
            from_ms: 0,
            to_ms: 1800000,
            kinds: vec![],
            cursor: None,
            limit: Some(501)
        })
        .await
        .is_err()
    );
    s.shutdown().await.unwrap();
}
#[test]
fn incomplete_event_coverage_ambiguous_roles_and_early_surrender_degrade_correctly() {
    let mut f = fixture("sgp");
    f["timeline"]["json"]["frames"][1]
        .as_object_mut()
        .unwrap()
        .remove("events");
    let m = match_summary(&f);
    let i =
        analysis::normalize(&f["summary"], Some(&f["timeline"]), &m, "synthetic-player").unwrap();
    assert_eq!(i.capabilities["timeline"].status, DataStatus::Partial);
    f["summary"]["json"]["participants"][2]["gameEndedInEarlySurrender"] = true.into();
    f["summary"]["json"]["participants"][3]["teamPosition"] = "MIDDLE".into();
    let m = match_summary(&f);
    assert_ne!(m.outcome, Outcome::Remake);
    let i = analysis::normalize(&f["summary"], None, &m, "synthetic-player").unwrap();
    assert!(!i.context.remake);
    assert!(analysis::opponent(&i.context).is_none());
}

#[tokio::test]
async fn local_review_and_report_performance_budget_on_fixed_synthetic_input() {
    let root = tempfile::tempdir().unwrap();
    let (s, _) = setup(root.path()).await;
    let r = make_report(&s).await;
    let i = db::required_input(&s.pool, &key(), r.input_revision)
        .await
        .unwrap();
    let mut reads = Vec::new();
    let mut computes = Vec::new();
    for _ in 0..30 {
        let start = std::time::Instant::now();
        let data = s
            .review_data(ReviewQuery {
                match_key: key().match_key,
                player_key: key().player_key,
                input_revision: None,
                report_id: Some(r.id.clone()),
            })
            .await
            .unwrap();
        assert_eq!(data.report.unwrap().id, r.id);
        reads.push(start.elapsed().as_secs_f64() * 1000.);
        let start = std::time::Instant::now();
        analysis::report(&i).unwrap();
        computes.push(start.elapsed().as_secs_f64() * 1000.);
    }
    reads.sort_by(f64::total_cmp);
    computes.sort_by(f64::total_cmp);
    let read_p95 = reads[28];
    let compute_p95 = computes[28];
    assert!(read_p95 < 500., "{read_p95}");
    assert!(compute_p95 < 2000., "{compute_p95}");
    let result = json!({"environment":std::env::consts::OS,"sample":"synthetic SGP, 30 minutes, warm SQLite cache","samples":30,"framePoints":i.frames.len(),"events":i.events.len(),"normalizedBytes":serde_json::to_vec(&i).unwrap().len(),"readP95Ms":read_p95,"computeP95Ms":compute_p95,"windows":"not_measured","peakMemory":"not_measured"});
    println!("Stage 2 performance: {result}");
    if let Ok(path) = std::env::var("RIFTMIND_PERF_REPORT") {
        tokio::fs::write(path, serde_json::to_vec_pretty(&result).unwrap())
            .await
            .unwrap();
    }
    s.shutdown().await.unwrap();
}
