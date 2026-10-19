use crate::contracts::*;
use serde_json::Value;
use std::collections::BTreeSet;

fn number(value: &Value, field: &str) -> Option<u32> {
    value.get(field)?.as_u64()?.try_into().ok()
}

fn display_name(participant: &Value, identity: Option<&Value>) -> Option<String> {
    let name = participant["riotIdGameName"]
        .as_str()
        .filter(|name| !name.is_empty())
        .or_else(|| identity.and_then(|player| player["gameName"].as_str()));
    if let Some(name) = name {
        let tag = participant["riotIdTagline"]
            .as_str()
            .or_else(|| identity.and_then(|player| player["tagLine"].as_str()));
        return Some(match tag.filter(|tag| !tag.is_empty()) {
            Some(tag) => format!("{name}#{tag}"),
            None => name.into(),
        });
    }
    participant["summonerName"]
        .as_str()
        .or_else(|| identity.and_then(|player| player["summonerName"].as_str()))
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

pub fn normalize(raw: &Value, summary: &MatchSummary) -> Result<MatchScoreboard> {
    let body = raw.get("json").unwrap_or(raw);
    let body = body.get("info").unwrap_or(body);
    let game_id = body["gameId"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| body["gameId"].as_u64().map(|id| id.to_string()));
    if game_id.as_deref() != Some(summary.game_id.as_str()) {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    if let Some(platform) = body["platformId"].as_str() {
        let server = if summary.server_id.starts_with("TENCENT_") {
            format!(
                "TENCENT_{}",
                platform.to_uppercase().trim_start_matches("TENCENT_")
            )
        } else {
            super::alias(platform)
        };
        if server != summary.server_id {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
    }
    let raw_participants = body["participants"]
        .as_array()
        .filter(|participants| !participants.is_empty() && participants.len() <= 32)
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput))?;
    let mut ids = BTreeSet::new();
    let mut participants = Vec::new();
    for (index, participant) in raw_participants.iter().enumerate() {
        let id = number(participant, "participantId").unwrap_or(index as u32 + 1);
        if id > 32 || !ids.insert(id) {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let identity = body["participantIdentities"]
            .as_array()
            .and_then(|identities| {
                identities
                    .iter()
                    .find(|identity| number(identity, "participantId") == Some(id))
            })
            .and_then(|identity| identity.get("player"));
        let puuid = participant["puuid"]
            .as_str()
            .or_else(|| identity.and_then(|player| player["puuid"].as_str()))
            .filter(|puuid| !puuid.is_empty());
        let stats = participant.get("stats").unwrap_or(participant);
        let styles = participant
            .pointer("/perks/styles")
            .and_then(Value::as_array);
        let primary_rune = styles
            .and_then(|styles| {
                styles
                    .iter()
                    .find(|style| style["description"] == "primaryStyle")
                    .or_else(|| styles.first())
            })
            .and_then(|style| style.pointer("/selections/0/perk"))
            .and_then(Value::as_u64)
            .and_then(|id| id.try_into().ok())
            .or_else(|| number(stats, "perk0"));
        let secondary_rune = styles
            .and_then(|styles| {
                styles
                    .iter()
                    .find(|style| style["description"] == "subStyle")
                    .or_else(|| styles.get(1))
            })
            .and_then(|style| number(style, "style"))
            .or_else(|| number(stats, "perkSubStyle"));
        participants.push(ScoreboardParticipant {
            id,
            player_key: puuid.map(|puuid| format!("{}:{puuid}", summary.server_id)),
            display_name: display_name(participant, identity),
            team_id: number(participant, "teamId").unwrap_or(0),
            champion_id: number(participant, "championId"),
            level: number(stats, "champLevel"),
            position: participant["teamPosition"]
                .as_str()
                .filter(|position| !position.is_empty())
                .or_else(|| {
                    participant
                        .pointer("/timeline/lane")
                        .and_then(Value::as_str)
                })
                .map(str::to_owned),
            win: stats["win"].as_bool(),
            kills: number(stats, "kills"),
            deaths: number(stats, "deaths"),
            assists: number(stats, "assists"),
            cs: number(stats, "totalMinionsKilled")
                .zip(number(stats, "neutralMinionsKilled"))
                .map(|(lane, jungle)| lane.saturating_add(jungle))
                .or_else(|| number(stats, "totalMinionsKilled")),
            gold: number(stats, "goldEarned"),
            damage: number(stats, "totalDamageDealtToChampions"),
            damage_taken: number(stats, "totalDamageTaken"),
            vision_score: number(stats, "visionScore"),
            wards_placed: number(stats, "wardsPlaced"),
            wards_killed: number(stats, "wardsKilled"),
            control_wards: number(stats, "detectorWardsPlaced")
                .or_else(|| number(stats, "visionWardsBoughtInGame")),
            spells: vec![
                number(participant, "spell1Id").unwrap_or(0),
                number(participant, "spell2Id").unwrap_or(0),
            ],
            primary_rune,
            secondary_rune,
            items: (0..7)
                .map(|slot| number(stats, &format!("item{slot}")).unwrap_or(0))
                .collect(),
            role_item: number(stats, "roleBoundItem").filter(|id| *id > 0),
            multi_kill: number(stats, "largestMultiKill"),
        });
    }
    let target_id = participants
        .iter()
        .find(|participant| participant.player_key.as_deref() == Some(summary.player_key.as_str()))
        .map(|participant| participant.id);
    let team_ids: BTreeSet<_> = participants
        .iter()
        .map(|participant| participant.team_id)
        .collect();
    let teams = team_ids
        .into_iter()
        .map(|team_id| {
            let members: Vec<_> = participants
                .iter()
                .filter(|participant| participant.team_id == team_id)
                .collect();
            let team = body["teams"].as_array().and_then(|teams| {
                teams
                    .iter()
                    .find(|team| number(team, "teamId") == Some(team_id))
            });
            let objective = |name: &str, legacy: &str| {
                team.and_then(|team| team.get("objectives"))
                    .and_then(|objectives| objectives.get(name))
                    .and_then(|objective| number(objective, "kills"))
                    .or_else(|| team.and_then(|team| number(team, legacy)))
            };
            ScoreboardTeam {
                id: team_id,
                win: team
                    .and_then(|team| {
                        team["win"]
                            .as_bool()
                            .or_else(|| team["win"].as_str().map(|result| result == "Win"))
                    })
                    .or_else(|| members.iter().find_map(|participant| participant.win)),
                kills: objective("champion", "championKills")
                    .or_else(|| members.iter().map(|participant| participant.kills).sum()),
                gold: members.iter().map(|participant| participant.gold).sum(),
                damage: members.iter().map(|participant| participant.damage).sum(),
                barons: objective("baron", "baronKills"),
                dragons: objective("dragon", "dragonKills"),
                towers: objective("tower", "towerKills"),
                inhibitors: objective("inhibitor", "inhibitorKills"),
                rift_heralds: objective("riftHerald", "riftHeraldKills"),
                void_grubs: objective("horde", "hordeKills"),
            }
        })
        .collect();
    Ok(MatchScoreboard {
        match_key: summary.match_key.clone(),
        target_id,
        participants,
        teams,
        source: summary.source.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn summary() -> MatchSummary {
        serde_json::from_value(json!({"matchKey":"NA1:42","playerKey":"NA1:player","gameId":"42","serverId":"NA1","startedAt":"2026-10-19T00:00:00Z","queueId":420,"championId":103,"version":"16.20","outcome":"win","kills":0,"deaths":1,"assists":2,"duration":900,"position":"MIDDLE","cs":0,"items":[],"source":"sgp","fallbackReason":null,"revision":1,"reviewState":null})).unwrap()
    }
    #[test]
    fn preserves_sgp_slots_runes_and_real_zero_statistics() {
        let raw = json!({"json":{"gameId":42,"platformId":"NA1","participants":[{"participantId":1,"puuid":"player","riotIdGameName":"Player","riotIdTagline":"NA1","teamId":100,"championId":103,"champLevel":12,"kills":0,"deaths":1,"assists":2,"totalMinionsKilled":0,"neutralMinionsKilled":0,"goldEarned":0,"totalDamageDealtToChampions":0,"item1":3020,"item6":3340,"roleBoundItem":4005,"spell1Id":4,"spell2Id":14,"perks":{"styles":[{"description":"primaryStyle","selections":[{"perk":8112}],"style":8100},{"description":"subStyle","style":8200}]}},{"participantId":2,"puuid":"other","teamId":200,"championId":64}],"teams":[{"teamId":100,"win":true,"objectives":{"dragon":{"kills":2}}}]}});
        let board = normalize(&raw, &summary()).unwrap();
        assert_eq!(board.target_id, Some(1));
        assert_eq!(board.participants[0].items, vec![0, 3020, 0, 0, 0, 0, 3340]);
        assert_eq!(board.participants[0].primary_rune, Some(8112));
        assert_eq!(board.participants[0].secondary_rune, Some(8200));
        assert_eq!(
            board.participants[0].display_name.as_deref(),
            Some("Player#NA1")
        );
        assert_eq!(board.teams[0].gold, Some(0));
        assert_eq!(board.teams[1].gold, None);
        assert_eq!(board.teams[0].dragons, Some(2));
    }
    #[test]
    fn maps_lcu_identity_nested_stats_and_rejects_a_different_match_or_region() {
        let mut raw = json!({"gameId":42,"platformId":"NA1","participantIdentities":[{"participantId":1,"player":{"puuid":"player","gameName":"Player","tagLine":"TAG"}}],"participants":[{"participantId":1,"teamId":100,"championId":103,"spell1Id":4,"spell2Id":14,"stats":{"champLevel":18,"kills":0,"perk0":8112,"perkSubStyle":8200,"wardsPlaced":0,"item0":3020}}]});
        let board = normalize(&raw, &summary()).unwrap();
        assert_eq!(board.participants[0].level, Some(18));
        assert_eq!(board.participants[0].wards_placed, Some(0));
        assert_eq!(board.target_id, Some(1));
        raw["gameId"] = 43.into();
        assert!(normalize(&raw, &summary()).is_err());
        raw["gameId"] = 42.into();
        raw["platformId"] = "EUW1".into();
        assert_eq!(
            normalize(&raw, &summary()).unwrap_err().code,
            ErrorCode::RegionConflict
        );
    }
}
