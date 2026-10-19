use riftmind_core::{clients, contracts::*, domain::analysis, storage};
use serde_json::{Value, json};
fn main() {
    let raw: Value =
        serde_json::from_str(include_str!("../../../../tests/fixtures/review/sgp.json")).unwrap();
    let p = clients::synthetic_player("TENCENT_HN1");
    let m = clients::normalize(
        &json!({"games":[raw["summary"].clone()]}),
        &p,
        Source::Sgp,
        None,
    )
    .unwrap()
    .remove(0);
    let mut input =
        analysis::normalize(&raw["summary"], Some(&raw["timeline"]), &m, &p.puuid).unwrap();
    input.id = "fixture-input".into();
    input.revision = 1;
    input.summary_snapshot = "fixture-summary".into();
    input.timeline_snapshot = Some("fixture-timeline".into());
    input.fingerprint = storage::hash(&serde_json::to_vec(&input).unwrap());
    let mut report = analysis::report(&input).unwrap();
    report.id = "fixture-report".into();
    report.revision = 1;
    report.generated_at = "2026-10-19T00:00:00Z".into();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"input":input,"report":report})).unwrap()
    );
}
