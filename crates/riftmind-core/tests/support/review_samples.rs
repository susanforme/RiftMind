use riftmind_core::{
    clients,
    contracts::*,
    domain::analysis,
    services::Service,
    settings::JsonSettingsStore,
    storage::{self, review as db},
};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};
pub async fn service(root: &Path) -> Arc<Service> {
    Service::new(
        storage::open(&root.join("riftmind.db")).await.unwrap(),
        root.into(),
        Arc::new(JsonSettingsStore(root.join("settings.json"))),
    )
    .await
    .unwrap()
}
pub async fn seed(
    service: &Service,
    id: &str,
    started: &str,
    champion: u32,
) -> (MatchSummary, AnalysisInput, ReviewReport) {
    let player = clients::synthetic_player("TENCENT_HN1");
    storage::save_player(&service.pool, &player).await.unwrap();
    let fixture: Value =
        serde_json::from_str(include_str!("../../../../tests/fixtures/review/sgp.json")).unwrap();
    let mut raw = fixture["summary"].clone();
    raw["json"]["gameId"] = id.into();
    let mut timeline = fixture["timeline"].clone();
    timeline["json"]["gameId"] = id.into();
    let mut summary =
        clients::normalize(&json!({"games":[raw.clone()]}), &player, Source::Sgp, None)
            .unwrap()
            .remove(0);
    summary.started_at = started.into();
    summary.champion_id = Some(champion);
    let task = Task {
        id: format!("seed-{id}"),
        player_key: Some(player.player_key.clone()),
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
        &[summary.clone()],
        &json!({"games":[raw.clone()]}),
        false,
    )
    .await
    .unwrap();
    let mut input = analysis::normalize(&raw, Some(&timeline), &summary, &player.puuid).unwrap();
    input.context.started_at = started.into();
    input
        .context
        .participants
        .iter_mut()
        .find(|participant| participant.id == input.context.target_id)
        .unwrap()
        .champion_id = Some(champion);
    let mut transaction = service.pool.begin().await.unwrap();
    let input = db::save_input_tx(
        &mut transaction,
        input,
        &summary,
        &raw,
        Some(&timeline),
        &Source::Sgp,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    let mut report = analysis::report(&input).unwrap();
    report.id = format!("report-{id}");
    report.revision = 1;
    report.generated_at = storage::now();
    sqlx::query("INSERT INTO reviews VALUES(?,?,?,?,?,?,?)")
        .bind(&report.id)
        .bind(&summary.match_key)
        .bind(&player.player_key)
        .bind(&input.id)
        .bind(report.revision)
        .bind(&report.rule_version)
        .bind(serde_json::to_string(&report).unwrap())
        .execute(&service.pool)
        .await
        .unwrap();
    (summary, input, report)
}
