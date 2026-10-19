use riftmind_core::{
    clients::{self, MatchRemote},
    contracts::*,
    services::{self, Service},
    storage,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
};
use tokio::sync::Mutex;
#[path = "support/review_samples.rs"]
mod review_samples;
fn content(kind: NotebookKind, title: &str) -> NotebookContent {
    NotebookContent {
        champion_id: 64,
        kind,
        title: title.into(),
        text: "Q1 → Q2; user text <script> remains text".into(),
        pinned: true,
        opponent_id: None,
        position: None,
        tags: vec!["ward hop".into()],
        steps: vec![],
        groups: vec![],
        map_id: None,
        resource_version: None,
        confirmed_patch: None,
        links: vec![],
        sources: vec![],
        skill_order: None,
    }
}
fn query(trash: bool) -> NotebookQuery {
    NotebookQuery {
        champion_id: Some(64),
        kind: None,
        search: String::new(),
        opponent_id: None,
        trash,
    }
}
async fn save(
    service: &Service,
    content: NotebookContent,
    previous: Option<&NotebookEntry>,
) -> NotebookEntry {
    service
        .save_notebook(SaveNotebook {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            id: previous.map(|entry| entry.id.clone()),
            expected_revision: previous.map_or(0, |entry| entry.revision),
            content,
            confirm_patch: None,
        })
        .await
        .unwrap()
}
async fn change(
    service: &Service,
    entry: &NotebookEntry,
    action: &str,
    revision: Option<u32>,
) -> Result<Empty> {
    service
        .change_notebook(ChangeNotebook {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            id: entry.id.clone(),
            expected_revision: entry.revision,
            action: action.into(),
            restore_revision: revision,
            confirm_permanent: action == "purge",
        })
        .await
}
#[tokio::test]
async fn offline_revisions_conflicts_recovery_practice_and_workspace_backup() {
    let root = tempfile::tempdir().unwrap();
    let service = review_samples::service(root.path()).await;
    assert!(storage::players(&service.pool).await.unwrap().is_empty());
    let first = save(&service, content(NotebookKind::Combo, "Ward hop"), None).await;
    let mut revised = first.content.clone();
    revised.steps = vec![
        ComboStep {
            action: ComboAction::Skill,
            entity_id: Some(1),
            label: "1".into(),
        },
        ComboStep {
            action: ComboAction::Skill,
            entity_id: Some(1),
            label: "2".into(),
        },
    ];
    revised.links.push(NotebookLink {
        entry_id: first.id.clone(),
        revision: 1,
    });
    let second = save(&service, revised.clone(), Some(&first)).await;
    let stale = service
        .save_notebook(SaveNotebook {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            id: Some(first.id.clone()),
            expected_revision: 1,
            content: revised,
            confirm_patch: None,
        })
        .await
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::RevisionConflict);
    assert_eq!(
        service
            .notebook_history(&first.id)
            .await
            .unwrap()
            .revisions
            .len(),
        2
    );
    let practice = PracticeEntry {
        id: "practice-ward-hop".into(),
        champion_id: 64,
        title: "Ward hop".into(),
        source_id: Some(first.id.clone()),
        source_revision: Some(1),
        state: PracticeState::Practicing,
        notes: "Manual progress".into(),
        revision: 0,
        updated_at: String::new(),
    };
    service
        .save_practice(SavePractice {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            entry: practice,
            expected_revision: 0,
            delete: false,
        })
        .await
        .unwrap();
    change(&service, &second, "trash", None).await.unwrap();
    assert!(
        service
            .notebook_entries(query(false))
            .await
            .unwrap()
            .is_empty()
    );
    let deleted = service
        .notebook_entries(query(true))
        .await
        .unwrap()
        .remove(0);
    assert_eq!(deleted.id, first.id);
    change(&service, &deleted, "recover", None).await.unwrap();
    let recovered = service
        .notebook_entries(query(false))
        .await
        .unwrap()
        .remove(0);
    change(&service, &recovered, "restore", Some(1))
        .await
        .unwrap();
    let restored = service
        .notebook_entries(query(false))
        .await
        .unwrap()
        .remove(0);
    assert_eq!(restored.revision, 5);
    assert!(restored.content.steps.is_empty());
    assert_eq!(
        service
            .notebook_history(&restored.id)
            .await
            .unwrap()
            .revisions
            .len(),
        5
    );
    let backup = service.backup().await.unwrap();
    let epoch = service.state.read().await.workspace_epoch.clone();
    change(&service, &restored, "trash", None).await.unwrap();
    service.restore(&backup.reference).await.unwrap();
    assert_ne!(epoch, service.state.read().await.workspace_epoch);
    let stale = service
        .save_notebook(SaveNotebook {
            workspace_epoch: epoch,
            id: None,
            expected_revision: 0,
            content: content(NotebookKind::Note, "old workspace"),
            confirm_patch: None,
        })
        .await
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::SessionChanged);
    assert_eq!(
        service.practice_entries(query(false)).await.unwrap()[0].notes,
        "Manual progress"
    );
    service.shutdown().await.unwrap();
    let restarted = review_samples::service(root.path()).await;
    assert_eq!(
        restarted.notebook_entries(query(false)).await.unwrap()[0].revision,
        5
    );
}
#[tokio::test]
async fn exchange_remaps_cycles_skips_duplicates_preserves_history_and_rolls_back() {
    let source_root = tempfile::tempdir().unwrap();
    let service = review_samples::service(source_root.path()).await;
    let first = save(&service, content(NotebookKind::Note, "First"), None).await;
    let mut linked = content(NotebookKind::Note, "Second");
    linked.links.push(NotebookLink {
        entry_id: first.id.clone(),
        revision: 1,
    });
    let second = save(&service, linked, None).await;
    let mut circular = first.content.clone();
    circular.links.push(NotebookLink {
        entry_id: second.id.clone(),
        revision: 1,
    });
    save(&service, circular, Some(&first)).await;
    let bundle = service.export_notebook(query(false)).await.unwrap();
    assert!(
        bundle
            .entries
            .iter()
            .all(|entry| entry.content.sources.is_empty())
    );
    let destination_root = tempfile::tempdir().unwrap();
    let destination = review_samples::service(destination_root.path()).await;
    let epoch = destination.state.read().await.workspace_epoch.clone();
    let request = NotebookTransfer {
        workspace_epoch: epoch.clone(),
        json: serde_json::to_string(&bundle).unwrap(),
        commit: false,
        replacements: BTreeMap::new(),
    };
    let preview = destination.import_notebook(request.clone()).await.unwrap();
    assert_eq!(
        (preview.added, preview.duplicates, preview.missing_links),
        (2, 0, 0)
    );
    assert!(
        destination
            .notebook_entries(query(false))
            .await
            .unwrap()
            .is_empty()
    );
    destination
        .import_notebook(NotebookTransfer {
            commit: true,
            ..request.clone()
        })
        .await
        .unwrap();
    let entries = destination.notebook_entries(query(false)).await.unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|entry| {
        !bundle
            .entries
            .iter()
            .any(|original| original.id == entry.id)
    }));
    assert!(entries.iter().all(|entry| {
        entries
            .iter()
            .any(|linked| linked.id == entry.content.links[0].entry_id)
    }));
    assert!(
        entries
            .iter()
            .all(|entry| entry.reviewed_revision.is_none())
    );
    let again = destination
        .import_notebook(NotebookTransfer {
            commit: true,
            ..request
        })
        .await
        .unwrap();
    assert_eq!((again.added, again.duplicates), (0, 2));
    let mut bad = bundle.clone();
    bad.entries[1].content.champion_id = 999999;
    assert!(
        destination
            .import_notebook(NotebookTransfer {
                workspace_epoch: epoch.clone(),
                json: serde_json::to_string(&bad).unwrap(),
                commit: true,
                replacements: BTreeMap::new()
            })
            .await
            .is_err()
    );
    assert_eq!(
        destination
            .notebook_entries(query(false))
            .await
            .unwrap()
            .len(),
        2
    );
    for version in [0, 2, 999] {
        bad = bundle.clone();
        bad.version = version;
        assert!(
            destination
                .import_notebook(NotebookTransfer {
                    workspace_epoch: epoch.clone(),
                    json: serde_json::to_string(&bad).unwrap(),
                    commit: true,
                    replacements: BTreeMap::new()
                })
                .await
                .is_err()
        );
    }
    let mut edited = bundle;
    edited.entries[0].content.text = "Replacement text".into();
    let replacement = &entries[0];
    let mut replacements = BTreeMap::new();
    replacements.insert(
        edited.entries[0].id.clone(),
        NotebookLink {
            entry_id: replacement.id.clone(),
            revision: replacement.revision,
        },
    );
    destination
        .import_notebook(NotebookTransfer {
            workspace_epoch: epoch,
            json: serde_json::to_string(&edited).unwrap(),
            commit: true,
            replacements,
        })
        .await
        .unwrap();
    assert_eq!(
        destination
            .notebook_history(&replacement.id)
            .await
            .unwrap()
            .revisions
            .len(),
        2
    );
}
#[tokio::test]
async fn patch_review_changes_are_explicit_and_invalid_ids_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let service = review_samples::service(root.path()).await;
    let mut note = content(NotebookKind::Note, "Review");
    note.confirmed_patch = Some("16.20".into());
    let initial = save(&service, note, None).await;
    assert_eq!(initial.reviewed_revision, None);
    let reviewed = service
        .save_notebook(SaveNotebook {
            workspace_epoch: service.state.read().await.workspace_epoch.clone(),
            id: Some(initial.id.clone()),
            expected_revision: 1,
            content: initial.content.clone(),
            confirm_patch: Some("16.20".into()),
        })
        .await
        .unwrap();
    assert_eq!(reviewed.reviewed_revision, Some(2));
    let modified = save(&service, reviewed.content.clone(), Some(&reviewed)).await;
    assert_eq!(modified.reviewed_revision, None);
    for champion_id in [0, 999999] {
        let mut invalid = content(NotebookKind::Note, "Invalid");
        invalid.champion_id = champion_id;
        assert!(services::notebooks::validate_content(&invalid).is_err());
    }
}
struct BuildRemote {
    collection: Mutex<Value>,
    phase: Mutex<String>,
    writes: AtomicU32,
    mode: AtomicU32,
}
#[async_trait::async_trait]
impl MatchRemote for BuildRemote {
    fn supports_item_sets(&self) -> bool {
        true
    }
    async fn page(&self, _: &Player, _: u32, _: Source) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    async fn current_match(&self) -> Result<Value> {
        Ok(json!({"phase":*self.phase.lock().await}))
    }
    async fn item_set_identity(&self) -> Result<Value> {
        Ok(json!({"summonerId":123,"puuid":"synthetic-player"}))
    }
    async fn item_sets(&self, _: u64) -> Result<Value> {
        Ok(self.collection.lock().await.clone())
    }
    async fn put_item_sets(&self, _: u64, collection: Value) -> Result<()> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        if self.mode.load(Ordering::SeqCst) != 2 {
            *self.collection.lock().await = collection;
        }
        if self.mode.load(Ordering::SeqCst) == 1 {
            Err(AppError::new(ErrorCode::NetworkUnavailable))
        } else {
            Ok(())
        }
    }
}
#[tokio::test]
async fn item_set_merge_idempotence_timeout_reconciliation_conflicts_and_gates() {
    let root = tempfile::tempdir().unwrap();
    let service = review_samples::service(root.path()).await;
    let catalogue = service
        .asset_root
        .join("catalogues/items-16.20.1-en_US.json");
    tokio::fs::create_dir_all(catalogue.parent().unwrap())
        .await
        .unwrap();
    tokio::fs::write(catalogue,serde_json::to_vec(&json!({"type":"item","version":"16.20.1","data":{"1001":{"name":"Boots","gold":{"purchasable":true},"maps":{"11":true,"12":true}},"999":{"name":"Unavailable","gold":{"purchasable":false},"maps":{"11":true}}}})).unwrap()).await.unwrap();
    let mut build = content(NotebookKind::Build, "Private build");
    build.resource_version = Some("16.20.1".into());
    build.map_id = Some(11);
    build.groups = vec![BuildGroup {
        name: "Core".into(),
        items: vec![BuildItem { id: 1001, count: 2 }],
    }];
    let entry = save(&service, build, None).await;
    let export = service
        .export_build(BuildExportQuery {
            entry_id: entry.id.clone(),
            target_version: "16.20.1".into(),
            map_id: 11,
        })
        .await
        .unwrap();
    let exported: Value = serde_json::from_str(&export.json).unwrap();
    assert!(export.issues.is_empty());
    let expected: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/notebooks/client-item-set.json"
    ))
    .unwrap();
    let mut comparable = exported.clone();
    comparable["uid"] = "fixed-example".into();
    assert_eq!(comparable, expected);
    assert_eq!(
        exported["blocks"][0]["items"][0],
        json!({"id":"1001","count":2})
    );
    assert!(!export.json.contains("user text"));
    assert_eq!(exported["associatedChampions"], json!([64]));
    let remote = Arc::new(BuildRemote {
        collection: Mutex::new(
            json!({"itemSets":[{"uid":"external","title":"Private build","unknown":{"keep":true}}],"unknownRoot":"preserved"}),
        ),
        phase: Mutex::new("ChampSelect".into()),
        writes: AtomicU32::new(0),
        mode: AtomicU32::new(1),
    });
    let player = clients::synthetic_player("TENCENT_HN1");
    service
        .set_connection(
            ConnectionState {
                phase: ConnectionPhase::Connected,
                player: Some(player),
                lcu_ready: true,
                ..ConnectionState::default()
            },
            Some(remote.clone()),
        )
        .await
        .unwrap();
    let query = BuildApplyQuery {
        workspace_epoch: service.state.read().await.workspace_epoch.clone(),
        entry_id: entry.id.clone(),
        expected_revision: 1,
        target_version: "16.20.1".into(),
        map_id: 11,
        save_as_new: false,
        overwrite_remote: false,
    };
    assert_eq!(
        service.apply_build(query.clone()).await.unwrap().state,
        "applied"
    );
    assert_eq!(
        service.apply_build(query.clone()).await.unwrap().state,
        "applied"
    );
    assert_eq!(remote.writes.load(Ordering::SeqCst), 1);
    let collection = remote.collection.lock().await.clone();
    assert_eq!(collection["unknownRoot"], "preserved");
    assert_eq!(collection["itemSets"][0]["unknown"]["keep"], true);
    assert_eq!(collection["itemSets"].as_array().unwrap().len(), 2);
    remote.collection.lock().await["itemSets"][1]["title"] = "Client edit".into();
    assert_eq!(
        service.apply_build(query.clone()).await.unwrap_err().code,
        ErrorCode::RevisionConflict
    );
    let new = BuildApplyQuery {
        save_as_new: true,
        ..query.clone()
    };
    service.apply_build(new).await.unwrap();
    assert_eq!(
        remote.collection.lock().await["itemSets"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    *remote.phase.lock().await = "InProgress".into();
    assert_eq!(
        service.apply_build(query.clone()).await.unwrap_err().code,
        ErrorCode::Forbidden
    );
    *remote.phase.lock().await = "ChampSelect".into();
    *remote.collection.lock().await = json!({"unknownShape":[]});
    assert_eq!(
        service.apply_build(query).await.unwrap_err().code,
        ErrorCode::DataIncomplete
    );
    assert_eq!(remote.writes.load(Ordering::SeqCst), 2);
}
#[test]
fn quantiles_use_independent_type_seven_expectations() {
    assert_eq!(
        services::review_insights::quantile(&[0., 10., 20., 30., 40.], 0.25),
        10.
    );
    assert_eq!(
        services::review_insights::quantile(&[0., 10., 20., 30., 40., 50.], 0.25),
        12.5
    );
    assert_eq!(
        services::review_insights::quantile(&[0., 10., 20., 30., 40., 50.], 0.5),
        25.
    );
}
#[tokio::test]
async fn history_baseline_thresholds_recent_twenty_and_fixed_refresh_membership() {
    let root = tempfile::tempdir().unwrap();
    let service = review_samples::service(root.path()).await;
    let (_, _, current) =
        review_samples::seed(&service, "current", "2026-10-19T12:00:00.000Z", 64).await;
    let query = PersonalBaselineQuery {
        report_id: current.id.clone(),
        all_champions: false,
        refresh: true,
        workspace_epoch: service.state.read().await.workspace_epoch.clone(),
    };
    let empty = service.personal_baseline(query.clone()).await.unwrap();
    assert_eq!(empty.scanned, 0);
    assert_eq!(empty.metrics[0].median, None);
    for number in 1..=25 {
        let (_, _, mut report) = review_samples::seed(
            &service,
            &format!("history-{number:02}"),
            &format!("2026-10-18T{:02}:{:02}:00.000Z", number / 60, number % 60),
            64,
        )
        .await;
        report
            .metrics
            .iter_mut()
            .find(|metric| metric.id == "cs_10")
            .unwrap()
            .value = Some(number as f64 * 10.);
        sqlx::query("UPDATE reviews SET payload=? WHERE id=?")
            .bind(serde_json::to_string(&report).unwrap())
            .bind(report.id)
            .execute(&service.pool)
            .await
            .unwrap();
        if number == 4 || number == 5 {
            let result = service.personal_baseline(query.clone()).await.unwrap();
            let metric = result
                .metrics
                .iter()
                .find(|metric| metric.id == "cs_10")
                .unwrap();
            assert_eq!(metric.count, number);
            if number == 4 {
                assert_eq!(metric.median, None);
            } else {
                assert_eq!(
                    (metric.median, metric.lower_quartile, metric.upper_quartile),
                    (Some(30.), Some(20.), Some(40.))
                );
            }
        }
    }
    let (_, _, future) =
        review_samples::seed(&service, "future", "2026-10-20T00:00:00.000Z", 64).await;
    let start = std::time::Instant::now();
    let fixed = service.personal_baseline(query.clone()).await.unwrap();
    let cold_query_ms = start.elapsed().as_secs_f64() * 1000.;
    let hot_start = std::time::Instant::now();
    let _ = service
        .personal_baseline(PersonalBaselineQuery {
            refresh: false,
            ..query.clone()
        })
        .await
        .unwrap();
    let hot_query_ms = hot_start.elapsed().as_secs_f64() * 1000.;
    assert!(cold_query_ms < 1000. && hot_query_ms < 250.);

    let metric = fixed
        .metrics
        .iter()
        .find(|metric| metric.id == "cs_10")
        .unwrap();
    assert_eq!(
        (
            metric.count,
            metric.median,
            metric.lower_quartile,
            metric.upper_quartile,
            metric.delta
        ),
        (20, Some(155.), Some(107.5), Some(202.5), Some(-85.))
    );
    assert!(
        metric
            .samples
            .iter()
            .all(|sample| sample.report_id.as_ref() != Some(&future.id)
                && sample.report_id.as_ref() != Some(&current.id))
    );
    assert_eq!(
        metric
            .samples
            .iter()
            .filter(|sample| sample.reason.as_deref() == Some("outside_sample_window"))
            .count(),
        5
    );
    let (different, _, _) = review_samples::seed(
        &service,
        "different-champion",
        "2026-10-19T11:00:00.000Z",
        103,
    )
    .await;
    let unchanged = service
        .personal_baseline(PersonalBaselineQuery {
            refresh: false,
            ..query.clone()
        })
        .await
        .unwrap();
    assert_eq!(unchanged.id, fixed.id);
    assert_eq!(unchanged.scanned, 25);
    let refreshed = service.personal_baseline(query.clone()).await.unwrap();
    assert_eq!(refreshed.metrics[0].count, 20);
    assert!(
        refreshed.metrics[0]
            .samples
            .iter()
            .any(|sample| sample.match_key == different.match_key
                && sample.reason.as_deref() == Some("champion_mismatch"))
    );
    let all = service
        .personal_baseline(PersonalBaselineQuery {
            all_champions: true,
            ..query
        })
        .await
        .unwrap();
    assert!(
        all.metrics[0]
            .samples
            .iter()
            .any(|sample| sample.match_key == different.match_key && sample.reason.is_none())
    );
    println!(
        "NOTEBOOK_PERFORMANCE {{\"historicalReports\":25,\"coldBaselineMs\":{cold_query_ms},\"frozenBaselineMs\":{hot_query_ms}}}"
    );
    let backup = service.backup().await.unwrap();
    service.restore(&backup.reference).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM personal_baselines")
            .fetch_one(&service.pool)
            .await
            .unwrap(),
        6
    );
}
#[tokio::test]
async fn event_context_clips_boundaries_preserves_same_time_events_and_fixed_report() {
    let root = tempfile::tempdir().unwrap();
    let service = review_samples::service(root.path()).await;
    let (_, input, report) =
        review_samples::seed(&service, "events", "2026-10-18T00:00:00.000Z", 64).await;
    let query = EventContextQuery {
        report_id: report.id.clone(),
        event_id: None,
        at_ms: Some(0),
        radius_ms: 60000,
        category: "all".into(),
    };
    let start = std::time::Instant::now();
    let beginning = service.event_context(query.clone()).await.unwrap();
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.;
    assert!(elapsed_ms < 250.);
    println!(
        "EVENT_CONTEXT_PERFORMANCE {{\"framePoints\":{},\"events\":{},\"queryMs\":{elapsed_ms}}}",
        input.frames.len(),
        input.events.len()
    );
    assert_eq!((beginning.from_ms, beginning.to_ms), (0, 60000));
    let ending = service
        .event_context(EventContextQuery {
            at_ms: Some(input.context.duration_ms),
            ..query.clone()
        })
        .await
        .unwrap();
    assert_eq!(ending.to_ms, input.context.duration_ms);
    assert_eq!(ending.input_revision, report.input_revision);
    if let Some(event) = input.events.iter().find(|event| {
        event.kind == "CHAMPION_KILL" && event.victim_id == Some(input.context.target_id)
    }) {
        let context = service
            .event_context(EventContextQuery {
                event_id: Some(event.id.clone()),
                at_ms: None,
                category: "death".into(),
                ..query
            })
            .await
            .unwrap();
        assert_eq!(context.focus.unwrap().id, event.id);
        assert_eq!(
            context.events.len(),
            input
                .events
                .iter()
                .filter(|event| event.timestamp_ms >= context.from_ms
                    && event.timestamp_ms <= context.to_ms)
                .count()
        );
        assert_eq!(context.report_id, report.id);
    }
}
#[tokio::test]
async fn champion_scope_controls_baseline_and_evaluations_without_reinterpreting_legacy_origin() {
    let root = tempfile::tempdir().unwrap();
    let service = review_samples::service(root.path()).await;
    for champion in [64, 103] {
        for number in 0..5 {
            review_samples::seed(
                &service,
                &format!("baseline-{champion}-{number}"),
                &format!("2020-01-01T00:0{number}:00.000Z"),
                champion,
            )
            .await;
        }
    }
    let epoch = service.state.read().await.workspace_epoch.clone();
    let goal = service
        .save_goal(SaveGoal {
            workspace_epoch: epoch.clone(),
            id: None,
            expected_revision: 0,
            scope: GoalScope {
                player_key: clients::synthetic_player("TENCENT_HN1").player_key,
                queue_id: 420,
                position: "MIDDLE".into(),
                patch: "16.20".into(),
                champion_id: Some(64),
                metric_id: "cs_10".into(),
                metric_version: "1".into(),
                direction: "increase".into(),
                target: 60.,
                origin: None,
            },
            state: GoalState::Active,
        })
        .await
        .unwrap();
    assert_eq!(goal.baseline.len(), 5);
    assert!(
        goal.baseline
            .iter()
            .all(|member| member.match_key.contains("baseline-64"))
    );
    for champion in [64, 103] {
        for number in 0..5 {
            review_samples::seed(
                &service,
                &format!("later-{champion}-{number}"),
                &format!("2099-01-01T00:0{number}:00.000Z"),
                champion,
            )
            .await;
        }
    }
    let task = service.start_evaluation(&goal.id).await.unwrap();
    service.await_task(&task.id).await.unwrap();
    let progress = service
        .goal_progress(GoalProgressQuery {
            goal_id: goal.id.clone(),
            revision: None,
        })
        .await
        .unwrap();
    assert_eq!(progress.evaluation.as_ref().unwrap().members.len(), 5);
    assert!(
        progress
            .evaluation
            .as_ref()
            .unwrap()
            .members
            .iter()
            .all(|member| member.match_key.contains("later-64"))
    );
    assert_eq!(progress.evaluation.as_ref().unwrap().achieved, Some(true));
    assert_eq!(progress.goal.state, GoalState::Active);
    let (unrelated, unrelated_input, _) = review_samples::seed(
        &service,
        "unrelated-champion-report",
        "2099-01-02T00:00:00.000Z",
        103,
    )
    .await;
    let task = service
        .start_review(GenerateReview {
            match_key: unrelated.match_key,
            player_key: unrelated.player_key,
            input_revision: unrelated_input.revision,
        })
        .await
        .unwrap();
    service.await_task(&task.id).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM goal_evaluations WHERE goal_id=?")
            .bind(&goal.id)
            .fetch_one(&service.pool)
            .await
            .unwrap(),
        1,
        "unrelated champion reports must not refresh this goal"
    );
    let mut legacy = serde_json::to_value(&goal).unwrap();
    legacy["scope"]
        .as_object_mut()
        .unwrap()
        .remove("championId");
    legacy["scope"]["origin"] = json!({"filter":{"playerKey":goal.scope.player_key,"championId":64,"queueId":420,"position":"MIDDLE","patch":"16.20","from":null,"to":null},"ruleId":"cs_10","ruleVersion":"1","reports":[]});
    legacy["revision"] = 2.into();
    sqlx::query("UPDATE training_goals SET payload=?,revision=2 WHERE id=?")
        .bind(serde_json::to_string(&legacy).unwrap())
        .bind(&goal.id)
        .execute(&service.pool)
        .await
        .unwrap();
    let task = service.start_evaluation(&goal.id).await.unwrap();
    service.await_task(&task.id).await.unwrap();
    let legacy_progress = service
        .goal_progress(GoalProgressQuery {
            goal_id: goal.id.clone(),
            revision: None,
        })
        .await
        .unwrap();
    assert!(legacy_progress.goal.scope.champion_id.is_none());
    assert_eq!(legacy_progress.evaluation.unwrap().members.len(), 10);
    let old = service
        .goal_progress(GoalProgressQuery {
            goal_id: goal.id,
            revision: Some(1),
        })
        .await
        .unwrap();
    assert_eq!(old.evaluation.unwrap().members.len(), 5);
}
#[tokio::test]
async fn bounded_preparation_uses_selected_members_persists_results_and_never_refetches_valid_reports()
 {
    let root = tempfile::tempdir().unwrap();
    let service = review_samples::service(root.path()).await;
    let mut keys = Vec::new();
    for number in 0..3 {
        let (summary, _, _) = review_samples::seed(
            &service,
            &format!("prepare-{number}"),
            &format!("2020-01-01T00:0{number}:00.000Z"),
            64,
        )
        .await;
        keys.push(summary.match_key);
    }
    let request = PrepareMatchesQuery {
        workspace_epoch: service.state.read().await.workspace_epoch.clone(),
        player_key: clients::synthetic_player("TENCENT_HN1").player_key,
        match_keys: keys.clone(),
        batch_id: None,
        recompute: false,
    };
    let preview = service.preview_preparation(request.clone()).await.unwrap();
    assert!(
        preview
            .members
            .iter()
            .all(|member| member.report == "existing")
    );
    let batch = service.start_preparation(request.clone()).await.unwrap();
    for _ in 0..100 {
        let current = service.list_preparations().await.unwrap();
        if current[0].state == "completed" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let completed = service.list_preparations().await.unwrap();
    assert_eq!(completed[0].state, "completed");
    assert_eq!(completed[0].members.len(), 3);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM reviews")
            .fetch_one(&service.pool)
            .await
            .unwrap(),
        3
    );
    let too_many = PrepareMatchesQuery {
        match_keys: (0..21)
            .map(|number| format!("TENCENT_HN1:{number}"))
            .collect(),
        ..request.clone()
    };
    assert_eq!(
        service
            .preview_preparation(too_many)
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    assert!(
        service
            .preview_preparation(PrepareMatchesQuery {
                match_keys: vec![],
                ..request
            })
            .await
            .is_err()
    );
    let backup = service.backup().await.unwrap();
    service.restore(&backup.reference).await.unwrap();
    assert_eq!(service.list_preparations().await.unwrap()[0].id, batch.id);
    service.shutdown().await.unwrap();
    let restarted = review_samples::service(root.path()).await;
    assert_eq!(
        restarted.list_preparations().await.unwrap()[0].state,
        "completed"
    );
}
#[tokio::test]
async fn failed_import_transaction_and_source_deletion_preserve_user_knowledge() {
    let root = tempfile::tempdir().unwrap();
    let service = review_samples::service(root.path()).await;
    let (summary, _, report) =
        review_samples::seed(&service, "deleted-source", "2020-01-01T00:00:00.000Z", 64).await;
    let mut note = content(NotebookKind::Note, "Retained note");
    note.sources = vec![NotebookSource {
        match_key: summary.match_key.clone(),
        player_key: summary.player_key.clone(),
        report_id: Some(report.id),
        evidence_id: None,
    }];
    let saved = save(&service, note, None).await;
    let mut transaction = service.pool.begin().await.unwrap();
    for table in [
        "reviews",
        "analysis_inputs",
        "detail_attempts",
        "snapshot_refs",
        "match_revisions",
        "matches",
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE match_key=?"))
            .bind(&summary.match_key)
            .execute(&mut *transaction)
            .await
            .unwrap();
    }
    transaction.commit().await.unwrap();
    let mut revised = saved.content.clone();
    revised.text = "Knowledge remains editable after source deletion".into();
    let retained = save(&service, revised, Some(&saved)).await;
    assert_eq!(retained.content.sources.len(), 1);
    let mut bundle = service.export_notebook(query(false)).await.unwrap();
    let mut rejected = bundle.entries[0].clone();
    rejected.id = "rejected-import".into();
    rejected.content.title = "Reject imported entry".into();
    rejected.content.text = "Different content".into();
    bundle.entries.push(rejected);
    bundle.entries[0].content.title = "Would be inserted first".into();
    sqlx::raw_sql("CREATE TRIGGER reject_import BEFORE INSERT ON notebook_revisions WHEN json_extract(NEW.payload,'$.content.title')='Reject imported entry' BEGIN SELECT RAISE(ABORT,'transaction test'); END;").execute(&service.pool).await.unwrap();
    assert!(
        service
            .import_notebook(NotebookTransfer {
                workspace_epoch: service.state.read().await.workspace_epoch.clone(),
                json: serde_json::to_string(&bundle).unwrap(),
                commit: true,
                replacements: BTreeMap::new()
            })
            .await
            .is_err()
    );
    assert_eq!(
        service.notebook_entries(query(false)).await.unwrap().len(),
        1
    );
    assert_eq!(
        service
            .notebook_history(&retained.id)
            .await
            .unwrap()
            .revisions
            .len(),
        2
    );
    let mut linked = content(NotebookKind::Note, "Related note");
    linked.links.push(NotebookLink {
        entry_id: retained.id.clone(),
        revision: retained.revision,
    });
    let linked = save(&service, linked, None).await;
    change(&service, &retained, "trash", None).await.unwrap();
    let deleted = service
        .notebook_entries(query(true))
        .await
        .unwrap()
        .remove(0);
    change(&service, &deleted, "purge", None).await.unwrap();
    let kept = save(&service, linked.content.clone(), Some(&linked)).await;
    assert_eq!(kept.content.links[0].entry_id, retained.id);
    assert_eq!(kept.content.text, linked.content.text);
}
#[tokio::test]
async fn desktop_backup_upgrade_keeps_sqlx_registry_consistent_for_native_recovery() {
    use base64::Engine;
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("desktop.db");
    let pool = storage::connect(&path).await.unwrap();
    let old = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            storage::SCHEMA_MIGRATIONS[..3]
                .iter()
                .map(|(version, description, sql)| {
                    sqlx::migrate::Migration::new(
                        *version,
                        (*description).into(),
                        sqlx::migrate::MigrationType::ReversibleUp,
                        (*sql).into(),
                        false,
                    )
                })
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    old.run(&pool).await.unwrap();
    let old_backup = root.path().join("old-desktop.db");
    storage::vacuum_backup(&pool, &old_backup).await.unwrap();
    pool.close().await;
    let bytes = tokio::fs::read(old_backup).await.unwrap();
    let bundle=serde_json::to_vec(&json!({"schemaVersion":3,"database":base64::engine::general_purpose::STANDARD.encode(&bytes),"sha256":storage::hash(&bytes),"settings":Settings::default()})).unwrap();
    let candidate = root.path().join("recovery-candidate.db");
    services::recovery::validate_bundle(&bundle, &candidate)
        .await
        .unwrap();
    let upgraded = storage::open(&candidate).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("PRAGMA user_version")
            .fetch_one(&upgraded)
            .await
            .unwrap(),
        i64::from(storage::DATABASE_VERSION)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT MAX(version) FROM _sqlx_migrations WHERE success=1")
            .fetch_one(&upgraded)
            .await
            .unwrap(),
        i64::from(storage::DATABASE_VERSION)
    );
    let current = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            storage::SCHEMA_MIGRATIONS
                .iter()
                .map(|(version, description, sql)| {
                    sqlx::migrate::Migration::new(
                        *version,
                        (*description).into(),
                        sqlx::migrate::MigrationType::ReversibleUp,
                        (*sql).into(),
                        false,
                    )
                })
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    current.run(&upgraded).await.unwrap();
}
