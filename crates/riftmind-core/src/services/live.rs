use super::*;
use crate::contracts::{LiveSeat, LiveSnapshot};
fn active(phase: &str) -> bool {
    [
        "ChampSelect",
        "GameStart",
        "InProgress",
        "Reconnect",
        "WaitingForStats",
        "PreEndOfGame",
        "EndOfGame",
    ]
    .contains(&phase)
}
fn number(v: &Value, k: &str) -> Option<u32> {
    v.get(k)?.as_u64()?.try_into().ok().filter(|n| *n > 0)
}
pub fn normalize_live(
    raw: &Value,
    c: &ConnectionState,
    old: &LiveSnapshot,
) -> Result<LiveSnapshot> {
    let phase = raw["phase"]
        .as_str()
        .ok_or(AppError::new(ErrorCode::InvalidInput))?;
    if phase.len() > 40 {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    let same_session = old.session_epoch == c.session_epoch;
    let mut next = LiveSnapshot {
        session_epoch: c.session_epoch.clone(),
        phase: phase.into(),
        revision: old.revision + 1,
        stale: false,
        ..LiveSnapshot::default()
    };
    if !active(phase) {
        return Ok(next);
    }
    let game = &raw["game"];
    let data = game.get("gameData").unwrap_or(game);
    next.game_id = data["gameId"]
        .as_str()
        .filter(|s| *s != "0")
        .map(str::to_string)
        .or_else(|| {
            data["gameId"]
                .as_u64()
                .filter(|n| *n > 0)
                .map(|n| n.to_string())
        });
    if let Some(id) = &next.game_id {
        domain::validate_key(id)?;
    }
    let new_game = old
        .game_id
        .as_ref()
        .zip(next.game_id.as_ref())
        .is_some_and(|(a, b)| a != b);
    if same_session
        && active(&old.phase)
        && !new_game
        && !(phase == "ChampSelect" && old.phase != "ChampSelect")
    {
        next.generation = old.generation.clone()
    }
    next.queue_id = number(data, "queueId")
        .or_else(|| number(&game["gameConfig"], "queueId"))
        .or_else(|| number(&game["gameData"]["queue"], "id"));
    next.mode = data["gameMode"].as_str().map(str::to_string);
    let server = c
        .identification
        .as_ref()
        .and_then(|i| i.server_id.as_deref());
    let champ = &raw["champSelect"];
    let teams = if phase == "ChampSelect" {
        vec![(1, &champ["myTeam"]), (2, &champ["theirTeam"])]
    } else {
        vec![(100, &data["teamOne"]), (200, &data["teamTwo"])]
    };
    for (team, list) in teams {
        if let Some(list) = list.as_array() {
            if list.len() > 32 {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            for (i, v) in list.iter().enumerate() {
                let puuid = v["puuid"].as_str().filter(|s| {
                    !s.is_empty() && *s != "0" && !s.chars().all(|ch| ch == '0' || ch == '-')
                });
                let player = if let Some((server, puuid)) = server.zip(puuid) {
                    domain::validate_key(puuid)?;
                    Some(Player {
                        player_key: format!("{server}:{puuid}"),
                        server_id: server.into(),
                        puuid: puuid.into(),
                        display_name: v["gameName"]
                            .as_str()
                            .or_else(|| v["summonerName"].as_str())
                            .filter(|s| !s.is_empty())
                            .map(
                                |name| match v["tagLine"].as_str().filter(|s| !s.is_empty()) {
                                    Some(tag) => format!("{name}#{tag}"),
                                    None => name.into(),
                                },
                            )
                            .unwrap_or_default(),
                        updated_at: storage::now(),
                    })
                } else {
                    None
                };
                let current = player
                    .as_ref()
                    .zip(c.player.as_ref())
                    .is_some_and(|(a, b)| a.player_key == b.player_key);
                next.seats.push(LiveSeat {
                    seat: v["cellId"]
                        .as_u64()
                        .and_then(|n| n.try_into().ok())
                        .unwrap_or(i as u32),
                    team_id: team,
                    player,
                    champion_id: number(v, "championId")
                        .or_else(|| number(v, "championPickIntent")),
                    spell_ids: ["spell1Id", "spell2Id"]
                        .iter()
                        .filter_map(|k| number(v, k))
                        .collect(),
                    position: v["assignedPosition"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(str::to_string),
                    current,
                });
            }
        }
    }
    if let Some(b) = champ["bans"].as_object() {
        for name in ["myTeamBans", "theirTeamBans"] {
            if let Some(ids) = b.get(name).and_then(Value::as_array) {
                next.bans.extend(
                    ids.iter()
                        .filter_map(Value::as_u64)
                        .filter_map(|n| u32::try_from(n).ok())
                        .filter(|n| *n > 0),
                )
            }
        }
    }
    if next.seats.is_empty()
        && [
            "GameStart",
            "InProgress",
            "Reconnect",
            "WaitingForStats",
            "PreEndOfGame",
            "EndOfGame",
        ]
        .contains(&phase)
        && same_session
        && !new_game
    {
        next.seats = old.seats.clone();
        next.bans = old.bans.clone();
        next.game_id = next.game_id.or_else(|| old.game_id.clone());
        next.generation = old.generation.clone();
        next.queue_id = next.queue_id.or(old.queue_id);
        next.mode = next.mode.or_else(|| old.mode.clone());
    }
    Ok(next)
}
impl Service {
    pub async fn refresh_live(self: &Arc<Self>) -> Result<LiveSnapshot> {
        let _single = self.live_lock.lock().await;
        let c = self.connection.read().await.clone();
        let epoch = self.state.read().await.workspace_epoch.clone();
        if c.phase != ConnectionPhase::Connected {
            return Ok(self.live.read().await.clone());
        }
        let remote = self
            .remote
            .read()
            .await
            .clone()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
        let raw = match remote.current_match().await {
            Ok(v) => v,
            Err(e) => {
                if self.connection.read().await.session_epoch == c.session_epoch
                    && self.state.read().await.workspace_epoch == epoch
                {
                    let mut live = self.live.write().await;
                    live.stale = true;
                    live.error = Some(e.code.clone());
                    drop(live);
                    self.emit("live-changed", None, 0).await;
                }
                return Err(e);
            }
        };
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&epoch).await?;
        let conn = self.connection.read().await;
        if conn.session_epoch != c.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        let mut old = self.live.write().await;
        let mut next = normalize_live(&raw, &c, &old)?;
        for seat in &next.seats {
            if let Some(p) = &seat.player {
                storage::save_player(&self.pool, p).await?
            }
        }
        if let Some((server, id)) = c
            .player
            .as_ref()
            .map(|p| &p.server_id)
            .zip(next.game_id.as_ref())
        {
            let key = format!("{server}:{id}");
            let saved: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM matches WHERE match_key=?)")
                    .bind(&key)
                    .fetch_one(&self.pool)
                    .await?;
            if saved {
                next.match_key = Some(key)
            }
        }
        let ended = next.phase == "EndOfGame" && old.phase != "EndOfGame";
        *old = next.clone();
        drop(old);
        drop(conn);
        drop(_workspace);
        self.emit("live-changed", Some(next.generation.clone()), next.revision)
            .await;
        if ended
            && self.settings.lock().await.auto_sync
            && let Some(p) = c.player
        {
            let _ = self
                .start_sync(SyncRequest {
                    player_key: p.player_key,
                    pages: 1,
                })
                .await;
        }
        Ok(next)
    }
    pub async fn live_snapshot(&self) -> Result<LiveSnapshot> {
        self.ready().await?;
        let mut s = self.live.read().await.clone();
        if let Some(id) = &s.game_id
            && let Some(p) = self.connection.read().await.player.as_ref()
        {
            let key = format!("{}:{id}", p.server_id);
            if sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM matches WHERE match_key=?)",
            )
            .bind(&key)
            .fetch_one(&self.pool)
            .await?
            {
                s.match_key = Some(key)
            }
        }
        Ok(s)
    }
    pub(super) async fn invalidate_live(&self, c: &ConnectionState, identity_changed: bool) {
        let mut live = self.live.write().await;
        if identity_changed && c.player.is_some() {
            *live = LiveSnapshot {
                session_epoch: c.session_epoch.clone(),
                ..LiveSnapshot::default()
            };
        } else if c.phase != ConnectionPhase::Connected {
            live.stale = true;
            live.revision += 1;
        }
        drop(live);
        self.emit("live-changed", None, 0).await;
    }
}
