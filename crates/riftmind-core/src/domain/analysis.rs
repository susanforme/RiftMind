use crate::contracts::*;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
pub const CONVERTER: &str = "2.1";
pub const RULES: &str = "2.1";
fn invalid() -> AppError {
    AppError::new(ErrorCode::InvalidInput)
}
fn number(v: &Value, key: &str) -> Option<u32> {
    v.get(key)?.as_u64()?.try_into().ok()
}
fn id(v: &Value) -> Option<String> {
    v.as_str()
        .map(str::to_owned)
        .or_else(|| v.as_u64().map(|n| n.to_string()))
}
fn body(v: &Value) -> &Value {
    let v = v.get("json").unwrap_or(v);
    v.get("info").unwrap_or(v)
}
fn prefix(v: &Value) -> String {
    format!(
        "{}{}",
        if v.get("json").is_some() { "/json" } else { "" },
        if v.get("json").unwrap_or(v).get("info").is_some() {
            "/info"
        } else {
            ""
        }
    )
}
pub fn supported(c: &MatchContext) -> bool {
    matches!(c.queue_id, Some(420 | 440))
        && c.map_id == Some(11)
        && c.mode.as_deref() == Some("CLASSIC")
}
pub fn patch(version: &str) -> String {
    version.split('.').take(2).collect::<Vec<_>>().join(".")
}
pub fn opponent(c: &MatchContext) -> Option<u32> {
    let p = c.participants.iter().find(|p| p.id == c.target_id)?;
    let position = p.position.as_ref()?;
    if !["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].contains(&position.as_str()) {
        return None;
    }
    let allies: Vec<_> = c
        .participants
        .iter()
        .filter(|x| x.team_id == p.team_id && x.position.as_ref() == Some(position))
        .collect();
    let enemies: Vec<_> = c
        .participants
        .iter()
        .filter(|x| x.team_id != p.team_id && x.position.as_ref() == Some(position))
        .collect();
    (allies.len() == 1 && enemies.len() == 1).then(|| enemies[0].id)
}
fn capability(ready: bool, from: Option<u32>, to: Option<u32>, reason: &str) -> Capability {
    Capability {
        status: if ready {
            DataStatus::Ready
        } else {
            DataStatus::Missing
        },
        from_ms: from,
        to_ms: to,
        reason: (!ready).then(|| reason.into()),
    }
}
pub fn normalize(
    summary: &Value,
    timeline: Option<&Value>,
    m: &MatchSummary,
    puuid: &str,
) -> Result<AnalysisInput> {
    let info = body(summary);
    if id(&info["gameId"]).as_deref() != Some(&m.game_id) {
        return Err(invalid());
    }
    if let Some(platform) = info["platformId"].as_str() {
        let server = if m.server_id.starts_with("TENCENT_") {
            format!(
                "TENCENT_{}",
                platform.to_uppercase().trim_start_matches("TENCENT_")
            )
        } else {
            super::alias(platform)
        };
        if server != m.server_id {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
    }
    let parts = info["participants"]
        .as_array()
        .filter(|p| !p.is_empty() && p.len() <= 32)
        .ok_or_else(invalid)?;
    let identities = info["participantIdentities"].as_array();
    let mut seen = BTreeSet::new();
    let mut participants = Vec::new();
    for (i, p) in parts.iter().enumerate() {
        let pid = number(p, "participantId").unwrap_or(i as u32 + 1);
        if !(1..=32).contains(&pid) || !seen.insert(pid) {
            return Err(invalid());
        }
        let identity =
            identities.and_then(|ids| ids.iter().find(|x| number(x, "participantId") == Some(pid)));
        let puuid = p["puuid"]
            .as_str()
            .or_else(|| {
                identity
                    .and_then(|x| x.pointer("/player/puuid"))
                    .and_then(Value::as_str)
            })
            .map(str::to_owned);
        let s = p.get("stats").unwrap_or(p);
        participants.push(Participant {
            id: pid,
            puuid,
            team_id: number(p, "teamId").unwrap_or(0),
            champion_id: number(p, "championId"),
            position: p["teamPosition"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            kills: number(s, "kills"),
            deaths: number(s, "deaths"),
            assists: number(s, "assists"),
            lane_cs: number(s, "totalMinionsKilled"),
            jungle_cs: number(s, "neutralMinionsKilled"),
            damage: number(s, "totalDamageDealtToChampions"),
            gold: number(s, "goldEarned"),
        });
    }
    let targets: Vec<_> = participants
        .iter()
        .filter(|p| p.puuid.as_deref() == Some(puuid))
        .collect();
    if targets.len() != 1 {
        return Err(invalid());
    }
    let target_id = targets[0].id;
    let duration_ms = number(info, "gameDuration")
        .and_then(|s| s.checked_mul(1000))
        .ok_or_else(invalid)?;
    if duration_ms > 12 * 60 * 60 * 1000 {
        return Err(invalid());
    }
    let mut team_kills = BTreeMap::new();
    if let Some(teams) = info["teams"].as_array() {
        for t in teams {
            if let Some(team) = number(t, "teamId")
                && let Some(k) = number(t, "championKills")
                    .or_else(|| number(&t["objectives"]["champion"], "kills"))
            {
                team_kills.insert(team.to_string(), k);
            }
        }
    }
    let context = MatchContext {
        match_key: m.match_key.clone(),
        player_key: m.player_key.clone(),
        target_id,
        participants,
        team_kills,
        queue_id: number(info, "queueId"),
        map_id: number(info, "mapId"),
        mode: info["gameMode"].as_str().map(str::to_owned),
        version: info["gameVersion"].as_str().unwrap_or("unknown").into(),
        duration_ms,
        started_at: m.started_at.clone(),
        remake: duration_ms < 300000
            && parts.iter().any(|p| {
                p.get("stats").unwrap_or(p)["gameEndedInEarlySurrender"].as_bool() == Some(true)
            })
            || (duration_ms < 300000 && m.outcome == Outcome::Remake),
        source: m.source.clone(),
    };
    let mut frames = Vec::new();
    let mut events: Vec<TimelineEvent> = Vec::new();
    let mut limitations = vec!["item_semantics_unavailable".into()];
    let mut event_coverage_complete = timeline.is_some();
    if let Some(raw) = timeline {
        let t = body(raw);
        let tb = prefix(raw);
        let tid = id(&t["gameId"]).or_else(|| {
            raw.pointer("/metadata/matchId")
                .and_then(Value::as_str)
                .and_then(|s| s.rsplit('_').next())
                .map(str::to_owned)
        });
        if tid.as_deref() != Some(&m.game_id) {
            return Err(invalid());
        }
        if let Some(mapping) = t["participants"].as_array() {
            for p in mapping {
                let pid = number(p, "participantId").ok_or_else(invalid)?;
                let expected = context
                    .participants
                    .iter()
                    .find(|x| x.id == pid)
                    .ok_or_else(invalid)?;
                if p["puuid"]
                    .as_str()
                    .is_some_and(|u| Some(u) != expected.puuid.as_deref())
                {
                    return Err(invalid());
                }
            }
        }
        let fs = t["frames"]
            .as_array()
            .filter(|f| f.len() <= 2000)
            .ok_or_else(invalid)?;
        if fs.iter().any(|f| f["events"].as_array().is_none()) {
            event_coverage_complete = false;
            limitations.push("event_gaps".into());
        }
        let mut prev = None;
        for (fi, f) in fs.iter().enumerate() {
            let timestamp = number(f, "timestamp").ok_or_else(invalid)?;
            if timestamp > duration_ms.saturating_add(60000) || prev.is_some_and(|p| timestamp <= p)
            {
                return Err(invalid());
            }
            prev = Some(timestamp);
            let pfs = f["participantFrames"].as_object().ok_or_else(invalid)?;
            for (key, p) in pfs {
                let pid = key.parse::<u32>().map_err(|_| invalid())?;
                if !seen.contains(&pid) || number(p, "participantId").is_some_and(|n| n != pid) {
                    return Err(invalid());
                }
                frames.push(FramePoint {
                    timestamp_ms: timestamp,
                    participant_id: pid,
                    gold: number(p, "totalGold"),
                    xp: number(p, "xp"),
                    cs: number(p, "minionsKilled")
                        .zip(number(p, "jungleMinionsKilled"))
                        .and_then(|(a, b)| a.checked_add(b)),
                    path: format!("{tb}/frames/{fi}/participantFrames/{key}"),
                });
            }
            if let Some(es) = f["events"].as_array() {
                for (ei, e) in es.iter().enumerate() {
                    if events.len() >= 50000 {
                        return Err(invalid());
                    }
                    let ts = number(e, "timestamp").ok_or_else(invalid)?;
                    if ts > duration_ms.saturating_add(60000) {
                        return Err(invalid());
                    }
                    for field in ["participantId", "killerId", "victimId", "creatorId"] {
                        if let Some(n) = number(e, field)
                            && n != 0
                            && !seen.contains(&n)
                        {
                            return Err(invalid());
                        }
                    }
                    let assisting_ids: Vec<u32> = e["assistingParticipantIds"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_u64().and_then(|n| u32::try_from(n).ok()))
                                .collect()
                        })
                        .unwrap_or_default();
                    if assisting_ids.iter().any(|n| !seen.contains(n)) {
                        return Err(invalid());
                    }
                    let kind = e["type"]
                        .as_str()
                        .filter(|s| s.len() <= 100)
                        .ok_or_else(invalid)?
                        .to_owned();
                    let participant_id = number(e, "participantId");
                    let undo_of = if kind == "ITEM_UNDO" {
                        events
                            .iter()
                            .rev()
                            .find(|p| {
                                p.participant_id == participant_id
                                    && ["ITEM_PURCHASED", "ITEM_SOLD"].contains(&p.kind.as_str())
                                    && (p.item_id == number(e, "beforeId")
                                        || p.item_id == number(e, "afterId"))
                            })
                            .map(|p| p.id.clone())
                    } else {
                        None
                    };
                    if kind == "ITEM_UNDO" && undo_of.is_none() {
                        limitations.push("unlinked_item_undo".into())
                    }
                    events.push(TimelineEvent {
                        id: format!("event-{fi}-{ei}"),
                        timestamp_ms: ts,
                        kind,
                        participant_id,
                        killer_id: number(e, "killerId"),
                        victim_id: number(e, "victimId"),
                        assisting_ids,
                        item_id: number(e, "itemId"),
                        skill_slot: number(e, "skillSlot"),
                        monster: e["monsterType"].as_str().map(str::to_owned),
                        undo_of,
                        path: format!("{tb}/frames/{fi}/events/{ei}"),
                        raw: e.clone(),
                    });
                }
            }
        }
        events.sort_by_key(|e| e.timestamp_ms); // Stable sort preserves original order for simultaneous events.
    }
    let target_frames: Vec<_> = frames
        .iter()
        .filter(|f| f.participant_id == target_id)
        .collect();
    let from = target_frames.first().map(|f| f.timestamp_ms);
    let to = target_frames.last().map(|f| f.timestamp_ms);
    let mut caps = BTreeMap::new();
    caps.insert(
        "summary".into(),
        capability(
            context.participants.len() == 10
                && context.participants.iter().all(|p| {
                    p.team_id != 0
                        && p.kills.is_some()
                        && p.deaths.is_some()
                        && p.assists.is_some()
                        && p.lane_cs.is_some()
                        && p.jungle_cs.is_some()
                        && p.damage.is_some()
                        && p.gold.is_some()
                }),
            None,
            None,
            "incomplete_participants",
        ),
    );
    if caps["summary"].status == DataStatus::Missing {
        caps.get_mut("summary").unwrap().status = DataStatus::Partial;
    }
    for (name, good) in [
        (
            "gold_frames",
            target_frames.iter().any(|f| f.gold.is_some()),
        ),
        ("cs_frames", target_frames.iter().any(|f| f.cs.is_some())),
        ("positions", opponent(&context).is_some()),
    ] {
        caps.insert(
            name.into(),
            capability(good, from, to, "missing_or_ambiguous"),
        );
    }
    let continuous = event_coverage_complete
        && target_frames
            .first()
            .is_some_and(|f| f.timestamp_ms <= 60000)
        && to.is_some_and(|t| duration_ms.saturating_sub(t) <= 60000)
        && target_frames
            .windows(2)
            .all(|w| w[1].timestamp_ms - w[0].timestamp_ms <= 60000)
        && target_frames
            .iter()
            .all(|f| f.gold.is_some() && f.cs.is_some());
    for (name, kinds) in [
        ("kills", vec!["CHAMPION_KILL"]),
        ("objectives", vec!["ELITE_MONSTER_KILL", "BUILDING_KILL"]),
        ("items", vec!["ITEM_PURCHASED", "ITEM_SOLD", "ITEM_UNDO"]),
        ("skills", vec!["SKILL_LEVEL_UP"]),
    ] {
        caps.insert(
            name.into(),
            Capability {
                status: if timeline.is_none() {
                    DataStatus::Missing
                } else if continuous {
                    DataStatus::Ready
                } else {
                    DataStatus::Partial
                },
                from_ms: from,
                to_ms: to,
                reason: (!continuous).then(|| format!("partial_{}", kinds.join("_"))),
            },
        );
    }
    caps.insert(
        "timeline".into(),
        Capability {
            status: if timeline.is_none() {
                DataStatus::Missing
            } else if continuous {
                DataStatus::Ready
            } else {
                DataStatus::Partial
            },
            from_ms: from,
            to_ms: to,
            reason: (!continuous).then(|| "timeline_gaps".into()),
        },
    );
    if opponent(&context).is_none() {
        limitations.push("opponent_unreliable".into())
    }
    if !continuous {
        limitations.push("timeline_gaps".into())
    }
    if !supported(&context) {
        limitations.push("mode_unsupported".into())
    }
    limitations.sort();
    limitations.dedup();
    Ok(AnalysisInput {
        id: String::new(),
        revision: 0,
        fingerprint: String::new(),
        converter_version: CONVERTER.into(),
        summary_snapshot: String::new(),
        timeline_snapshot: None,
        context,
        capabilities: caps,
        frames,
        events,
        limitations,
    })
}
fn metric(
    id: &str,
    unit: &str,
    value: Option<f64>,
    denominator: Option<f64>,
    sampled: Option<u32>,
    status: MetricStatus,
    reason: Option<&str>,
) -> MetricResult {
    MetricResult {
        id: id.into(),
        version: "1".into(),
        unit: unit.into(),
        value: value.filter(|n| n.is_finite()),
        denominator,
        sampled_at_ms: sampled,
        status,
        reason: reason.map(str::to_owned),
    }
}
fn basic(id: &str, unit: &str, value: Option<f64>) -> MetricResult {
    metric(
        id,
        unit,
        value,
        None,
        None,
        if value.is_some() {
            MetricStatus::Available
        } else {
            MetricStatus::Missing
        },
        value.is_none().then_some("missing_fields"),
    )
}
fn ratio(id: &str, unit: &str, num: Option<f64>, denom: Option<f64>) -> MetricResult {
    match num.zip(denom) {
        Some((n, d)) if d > 0. => metric(
            id,
            unit,
            Some(n / d),
            Some(d),
            None,
            MetricStatus::Available,
            None,
        ),
        Some((_, d)) => metric(
            id,
            unit,
            None,
            Some(d),
            None,
            MetricStatus::NotApplicable,
            Some("zero_denominator"),
        ),
        None => metric(
            id,
            unit,
            None,
            denom,
            None,
            MetricStatus::Missing,
            Some("missing_fields"),
        ),
    }
}
pub fn metrics(input: &AnalysisInput) -> Vec<MetricResult> {
    let c = &input.context;
    let p = c
        .participants
        .iter()
        .find(|p| p.id == c.target_id)
        .expect("validated target");
    let minutes = c.duration_ms as f64 / 60000.;
    let cs = p
        .lane_cs
        .zip(p.jungle_cs)
        .and_then(|(a, b)| a.checked_add(b))
        .map(f64::from);
    let mut m = vec![
        basic("kills", "count", p.kills.map(f64::from)),
        basic("deaths", "count", p.deaths.map(f64::from)),
        basic("assists", "count", p.assists.map(f64::from)),
        ratio(
            "kda",
            "ratio",
            p.kills.zip(p.assists).map(|(a, b)| a as f64 + b as f64),
            p.deaths.map(f64::from),
        ),
        basic("lane_cs", "count", p.lane_cs.map(f64::from)),
        basic("jungle_cs", "count", p.jungle_cs.map(f64::from)),
        basic("total_cs", "count", cs),
        ratio("cs_per_min", "per_min", cs, Some(minutes)),
        ratio(
            "deaths_per_10",
            "per_10_min",
            p.deaths.map(|n| n as f64 * 10.),
            Some(minutes),
        ),
        ratio(
            "participation",
            "ratio",
            p.kills.zip(p.assists).map(|(a, b)| a as f64 + b as f64),
            c.team_kills.get(&p.team_id.to_string()).map(|n| *n as f64),
        ),
    ];
    let team: Vec<_> = c
        .participants
        .iter()
        .filter(|t| t.team_id == p.team_id)
        .collect();
    for (name, is_gold) in [("gold_share", true), ("damage_share", false)] {
        let values: Option<Vec<_>> = team
            .iter()
            .map(|t| {
                if is_gold {
                    t.gold.map(f64::from)
                } else {
                    t.damage.map(f64::from)
                }
            })
            .collect();
        let denominator = values.filter(|v| v.len() == 5).map(|v| v.iter().sum());
        m.push(ratio(
            name,
            "ratio",
            if is_gold {
                p.gold.map(f64::from)
            } else {
                p.damage.map(f64::from)
            },
            denominator,
        ));
    }
    for target in [600000, 900000] {
        let minute = target / 60000;
        let f = input
            .frames
            .iter()
            .filter(|f| {
                f.participant_id == p.id
                    && f.timestamp_ms <= target
                    && target - f.timestamp_ms <= 60000
            })
            .max_by_key(|f| f.timestamp_ms);
        let enemy = opponent(c).and_then(|id| {
            f.and_then(|t| {
                input
                    .frames
                    .iter()
                    .find(|e| e.participant_id == id && e.timestamp_ms == t.timestamp_ms)
            })
        });
        for (name, value) in [
            ("cs", f.and_then(|f| f.cs).map(f64::from)),
            ("gold", f.and_then(|f| f.gold).map(f64::from)),
            ("xp", f.and_then(|f| f.xp).map(f64::from)),
            (
                "cs_diff",
                f.and_then(|f| f.cs)
                    .zip(enemy.and_then(|e| e.cs))
                    .map(|(a, b)| a as f64 - b as f64),
            ),
            (
                "gold_diff",
                f.and_then(|f| f.gold)
                    .zip(enemy.and_then(|e| e.gold))
                    .map(|(a, b)| a as f64 - b as f64),
            ),
            (
                "xp_diff",
                f.and_then(|f| f.xp)
                    .zip(enemy.and_then(|e| e.xp))
                    .map(|(a, b)| a as f64 - b as f64),
            ),
        ] {
            let available = value.is_some() && c.duration_ms >= target;
            m.push(metric(
                &format!("{name}_{minute}"),
                if name.starts_with("gold") {
                    "gold"
                } else if name.starts_with("xp") {
                    "xp"
                } else {
                    "count"
                },
                available.then_some(value).flatten(),
                None,
                f.map(|f| f.timestamp_ms),
                if c.duration_ms < target {
                    MetricStatus::NotApplicable
                } else if available {
                    MetricStatus::Available
                } else {
                    MetricStatus::Missing
                },
                if c.duration_ms < target {
                    Some("short_match")
                } else if !available {
                    Some("missing_frame_or_opponent")
                } else {
                    None
                },
            ));
        }
    }
    m
}
// All registered rules share the ranked/CLASSIC/map-11 scope in `supported`.
// None is an explicit all-patches declaration for rules that only describe recorded facts.
struct RuleSpec {
    id: &'static str,
    required: &'static [&'static str],
    patch_range: Option<((u32, u32), (u32, u32))>,
}
const RULE_REGISTRY: &[RuleSpec] = &[
    RuleSpec {
        id: "development",
        required: &["gold_frames", "positions"],
        patch_range: None,
    },
    RuleSpec {
        id: "deaths",
        required: &["kills"],
        patch_range: None,
    },
    RuleSpec {
        id: "objectives",
        required: &["objectives"],
        patch_range: None,
    },
    RuleSpec {
        id: "build",
        required: &["timeline"],
        patch_range: None,
    },
];
fn supports_rule(rule: &RuleSpec, input: &AnalysisInput) -> bool {
    if !supported(&input.context)
        || rule.required.iter().any(|name| {
            input
                .capabilities
                .get(*name)
                .is_none_or(|c| !matches!(c.status, DataStatus::Ready | DataStatus::Partial))
        })
    {
        return false;
    }
    if let Some((from, to)) = rule.patch_range {
        let mut version = input
            .context
            .version
            .split('.')
            .filter_map(|v| v.parse::<u32>().ok());
        let Some(version) = version.next().zip(version.next()) else {
            return false;
        };
        if version < from || version > to {
            return false;
        }
    }
    true
}
pub fn report(input: &AnalysisInput) -> Result<ReviewReport> {
    if !supported(&input.context) {
        return Err(AppError::new(ErrorCode::AnalysisUnsupported));
    }
    let m = metrics(input);
    let mut evidence = vec![EvidenceRef {
        id: "summary".into(),
        snapshot_id: input.summary_snapshot.clone(),
        path: String::new(),
        timestamp_ms: None,
        participant_ids: vec![input.context.target_id],
    }];
    let mut findings = Vec::new();
    let mut priority = 0;
    if input
        .context
        .participants
        .iter()
        .find(|p| p.id == input.context.target_id)
        .and_then(|p| p.deaths)
        == Some(0)
    {
        findings.push(Finding {
            id: format!("zero-deaths-{}", input.fingerprint),
            rule_id: "zero_deaths".into(),
            rule_version: "1".into(),
            priority: 0,
            message_key: "finding_zero_deaths".into(),
            action_key: None,
            params: BTreeMap::new(),
            metric_ids: vec!["deaths".into()],
            evidence_ids: vec!["summary".into()],
            limitations: vec![],
        });
    }
    let mut limitations = input.limitations.clone();
    for spec in RULE_REGISTRY {
        if !supports_rule(spec, input) {
            limitations.push(format!("rule_{}_missing", spec.id));
            continue;
        }
        let rule = &spec.id;
        let mut refs = Vec::new();
        let mut metric_ids = Vec::new();
        let mut params = BTreeMap::new();
        if *rule == "development" {
            if let Some(value) = m
                .iter()
                .find(|m| m.id == "gold_diff_10" && m.value.is_some())
            {
                let ts = value.sampled_at_ms.unwrap();
                for f in input.frames.iter().filter(|f| {
                    f.timestamp_ms == ts
                        && (f.participant_id == input.context.target_id
                            || Some(f.participant_id) == opponent(&input.context))
                }) {
                    let eid = format!("frame-{}-{}", f.participant_id, ts);
                    refs.push(eid.clone());
                    evidence.push(EvidenceRef {
                        id: eid,
                        snapshot_id: input
                            .timeline_snapshot
                            .clone()
                            .ok_or(AppError::new(ErrorCode::EvidenceUnavailable))?,
                        path: f.path.clone(),
                        timestamp_ms: Some(ts),
                        participant_ids: vec![f.participant_id],
                    });
                }
                params.insert("value".into(), value.value.unwrap().to_string());
                metric_ids.push(value.id.clone());
            }
        } else {
            let candidates: Vec<_> = input
                .events
                .iter()
                .filter(|e| match *rule {
                    "deaths" => {
                        e.kind == "CHAMPION_KILL" && e.victim_id == Some(input.context.target_id)
                    }
                    "objectives" => {
                        ["ELITE_MONSTER_KILL", "BUILDING_KILL"].contains(&e.kind.as_str())
                    }
                    "build" => {
                        ["ITEM_PURCHASED", "ITEM_SOLD", "ITEM_UNDO", "SKILL_LEVEL_UP"]
                            .contains(&e.kind.as_str())
                            && e.participant_id == Some(input.context.target_id)
                    }
                    _ => false,
                })
                .collect();
            params.insert("count".into(), candidates.len().to_string());
            for e in candidates.into_iter().take(12) {
                refs.push(e.id.clone());
                evidence.push(event_evidence(input, e)?);
            }
        }
        if !refs.is_empty() {
            let action = priority < 3;
            if action {
                priority += 1
            }
            findings.push(Finding {
                id: format!("{}-{}", rule, input.fingerprint),
                rule_id: (*rule).into(),
                rule_version: "1".into(),
                priority: if action { priority } else { 0 },
                message_key: format!("finding_{rule}"),
                action_key: action.then(|| format!("action_{rule}")),
                params,
                metric_ids,
                evidence_ids: refs,
                limitations: if *rule == "objectives" {
                    vec!["observation_window_60s_not_causation".into()]
                } else if *rule == "build" {
                    vec!["item_semantics_unavailable".into()]
                } else {
                    vec![]
                },
            });
        }
    }
    evidence.sort_by(|a, b| a.id.cmp(&b.id));
    evidence.dedup_by(|a, b| a.id == b.id);
    let out = ReviewReport {
        id: String::new(),
        revision: 0,
        match_key: input.context.match_key.clone(),
        player_key: input.context.player_key.clone(),
        input_revision: input.revision,
        input_fingerprint: input.fingerprint.clone(),
        rule_version: RULES.into(),
        semantic_version: None,
        metrics: m,
        findings,
        evidence,
        limitations,
        generated_at: String::new(),
    };
    validate_evidence(input, &out)?;
    Ok(out)
}
pub fn event_evidence(input: &AnalysisInput, e: &TimelineEvent) -> Result<EvidenceRef> {
    Ok(EvidenceRef {
        id: e.id.clone(),
        snapshot_id: input
            .timeline_snapshot
            .clone()
            .ok_or(AppError::new(ErrorCode::EvidenceUnavailable))?,
        path: e.path.clone(),
        timestamp_ms: Some(e.timestamp_ms),
        participant_ids: [e.participant_id, e.killer_id, e.victim_id]
            .into_iter()
            .flatten()
            .filter(|n| *n > 0)
            .chain(e.assisting_ids.iter().copied())
            .collect(),
    })
}
pub fn validate_evidence(input: &AnalysisInput, report: &ReviewReport) -> Result<()> {
    for e in &report.evidence {
        if e.snapshot_id != input.summary_snapshot
            && Some(&e.snapshot_id) != input.timeline_snapshot.as_ref()
        {
            return Err(AppError::new(ErrorCode::EvidenceUnavailable));
        }
    }
    for f in &report.findings {
        if f.evidence_ids.is_empty()
            || f.evidence_ids
                .iter()
                .any(|id| !report.evidence.iter().any(|e| &e.id == id))
        {
            return Err(AppError::new(ErrorCode::EvidenceUnavailable));
        }
    }
    Ok(())
}
pub fn chart(input: &AnalysisInput, from: u32, to: u32, budget: u32) -> Result<ChartData> {
    if from > to
        || to > input.context.duration_ms.saturating_add(60000)
        || !(2..=1000).contains(&budget)
    {
        return Err(invalid());
    }
    let enemy = opponent(&input.context);
    let frames: Vec<_> = input
        .frames
        .iter()
        .filter(|f| {
            f.participant_id == input.context.target_id
                && f.timestamp_ms >= from
                && f.timestamp_ms <= to
        })
        .collect();
    let mut points = Vec::new();
    let mut prev = None;
    for f in frames {
        if prev.is_some_and(|p| f.timestamp_ms - p > 60000) {
            points.push(ChartPoint {
                timestamp_ms: f.timestamp_ms - 1,
                gold: None,
                cs: None,
                opponent_gold: None,
                opponent_cs: None,
            })
        }
        prev = Some(f.timestamp_ms);
        let e = enemy.and_then(|id| {
            input
                .frames
                .iter()
                .find(|e| e.participant_id == id && e.timestamp_ms == f.timestamp_ms)
        });
        points.push(ChartPoint {
            timestamp_ms: f.timestamp_ms,
            gold: f.gold.map(f64::from),
            cs: f.cs.map(f64::from),
            opponent_gold: e.and_then(|e| e.gold).map(f64::from),
            opponent_cs: e.and_then(|e| e.cs).map(f64::from),
        });
    }
    // Bucket reduction keeps a null in any bucket containing a gap, never bridging missing data.
    if points.len() > budget as usize {
        let count = points.len();
        points = (0..budget as usize)
            .map(|i| {
                let start = i * count / budget as usize;
                let end = ((i + 1) * count / budget as usize).max(start + 1);
                let slice = &points[start..end];
                let mut point = slice[slice.len() - 1].clone();
                if slice.iter().any(|p| p.gold.is_none()) {
                    point.gold = None;
                }
                if slice.iter().any(|p| p.cs.is_none()) {
                    point.cs = None;
                }
                if slice.iter().any(|p| p.opponent_gold.is_none()) {
                    point.opponent_gold = None;
                }
                if slice.iter().any(|p| p.opponent_cs.is_none()) {
                    point.opponent_cs = None;
                }
                point
            })
            .collect();
    }
    Ok(ChartData {
        points,
        limitations: input.limitations.clone(),
    })
}
