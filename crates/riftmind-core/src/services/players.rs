use super::*;
use std::collections::BTreeMap;
pub fn sample(values: impl IntoIterator<Item = Option<f64>>) -> SampleMetric {
    let mut samples = 0;
    let mut sum = 0.;
    let mut excluded = BTreeMap::new();
    for v in values {
        match v.filter(|v| v.is_finite()) {
            Some(v) => {
                samples += 1;
                sum += v
            }
            None => *excluded.entry("missing".into()).or_default() += 1,
        }
    }
    SampleMetric {
        value: (samples > 0).then(|| sum / samples as f64),
        samples,
        excluded,
    }
}
pub fn win_rate(items: &[MatchSummary]) -> SampleMetric {
    let mut out = sample(items.iter().filter_map(|m| match m.outcome {
        Outcome::Win => Some(Some(1.)),
        Outcome::Loss => Some(Some(0.)),
        _ => None,
    }));
    for m in items {
        if matches!(m.outcome, Outcome::Remake | Outcome::Unknown) {
            *out.excluded
                .entry(
                    if m.outcome == Outcome::Remake {
                        "remake"
                    } else {
                        "unknown_outcome"
                    }
                    .into(),
                )
                .or_default() += 1;
        }
    }
    out
}
pub fn kda(m: &MatchSummary) -> Option<f64> {
    m.kills
        .zip(m.assists)
        .zip(m.deaths.filter(|d| *d > 0))
        .map(|((k, a), d)| (k as f64 + a as f64) / d as f64)
}
impl Service {
    pub(super) async fn same_region_player(
        &self,
        key: &str,
        c: &ConnectionState,
    ) -> Result<Player> {
        domain::validate_key(key)?;
        let server = c
            .identification
            .as_ref()
            .and_then(|i| i.server_id.as_ref())
            .ok_or(AppError::new(ErrorCode::RegionUnknown))?;
        let logged = c
            .player
            .as_ref()
            .ok_or(AppError::new(ErrorCode::WaitingAuth))?;
        if &logged.server_id != server {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
        let p = storage::players(&self.pool)
            .await?
            .into_iter()
            .find(|p| p.player_key == key)
            .ok_or(AppError::new(ErrorCode::NotFound))?;
        if &p.server_id != server || key != format!("{}:{}", p.server_id, p.puuid) {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
        Ok(p)
    }
    fn online(c: &ConnectionState) -> Result<()> {
        match c.phase {
            ConnectionPhase::Connected => Ok(()),
            ConnectionPhase::CoolingDown => Err(AppError::new(ErrorCode::RateLimited)),
            ConnectionPhase::WaitingAuth => Err(AppError::new(ErrorCode::WaitingAuth)),
            _ => Err(AppError::new(ErrorCode::ClientNotFound)),
        }
    }
    pub(super) async fn record_player_error(&self, error: AppError, session: &str) -> AppError {
        if error.code == ErrorCode::RateLimited {
            let mut c = self.connection.write().await;
            if c.session_epoch == session {
                c.phase = ConnectionPhase::CoolingDown;
                c.retry_at = Some(
                    (chrono::Utc::now()
                        + chrono::Duration::seconds(
                            error
                                .params
                                .get("retryAfter")
                                .and_then(|s| s.parse::<i64>().ok())
                                .unwrap_or(60)
                                .clamp(1, 3600),
                        ))
                    .to_rfc3339(),
                );
            }
        }
        if error.code == ErrorCode::RateLimited {
            self.emit("connection-changed", None, 0).await;
        }
        error
    }
    pub async fn search_player(&self, q: PlayerSearch) -> Result<Player> {
        let query = q.query.trim();
        if query.is_empty()
            || query.chars().count() > 100
            || query.chars().any(char::is_control)
            || query.contains(['/', '\\'])
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        if query.contains('#')
            && query
                .rsplit_once('#')
                .is_none_or(|(a, b)| a.is_empty() || b.is_empty() || a.contains('#'))
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        self.ready().await?;
        let epoch = self.state.read().await.workspace_epoch.clone();
        let c = self.connection.read().await.clone();
        let _single = self.player_search_lock.lock().await;
        self.check_workspace(&epoch).await?;
        if self.connection.read().await.session_epoch != c.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        Self::online(&c)?;
        let server = c
            .identification
            .as_ref()
            .and_then(|i| i.server_id.as_ref())
            .ok_or(AppError::new(ErrorCode::RegionUnknown))?;
        let remote = self
            .remote
            .read()
            .await
            .clone()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
        let raw = remote.search(query).await.map_err(|mut e| {
            if e.code == ErrorCode::EndpointUnsupported {
                e.params.insert("operation".into(), "player_search".into());
            }
            e
        });
        let raw = match raw {
            Ok(v) => v,
            Err(e) => return Err(self.record_player_error(e, &c.session_epoch).await),
        };
        let p = clients::player_from_summoner(&raw, server, query)?;
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&epoch).await?;
        let current = self.connection.read().await;
        if current.session_epoch != c.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        let p = storage::save_player(&self.pool, &p).await?;
        drop(current);
        self.emit("players-changed", Some(p.player_key.clone()), 0)
            .await;
        Ok(p)
    }
    pub async fn favorites(&self) -> Result<Vec<Player>> {
        self.ready().await?;
        let keys: Vec<String> = sqlx::query_scalar(
            "SELECT player_key FROM favorites ORDER BY created_at DESC,player_key LIMIT 1000",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(storage::players(&self.pool)
            .await?
            .into_iter()
            .filter(|p| keys.contains(&p.player_key))
            .collect())
    }
    pub async fn set_favorite(&self, q: FavoriteChange) -> Result<Vec<Player>> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&q.workspace_epoch).await?;
        domain::validate_key(&q.player_key)?;
        if q.favorite {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM players WHERE player_key=?)")
                    .bind(&q.player_key)
                    .fetch_one(&self.pool)
                    .await?;
            if !exists {
                return Err(AppError::new(ErrorCode::NotFound));
            }
            sqlx::query("INSERT OR IGNORE INTO favorites VALUES(?,?)")
                .bind(&q.player_key)
                .bind(storage::now())
                .execute(&self.pool)
                .await?;
        } else {
            sqlx::query("DELETE FROM favorites WHERE player_key=?")
                .bind(&q.player_key)
                .execute(&self.pool)
                .await?;
        }
        self.emit("favorites-changed", Some(q.player_key), 0).await;
        self.favorites().await
    }
    pub async fn player_profile(&self, q: PlayerProfileQuery) -> Result<PlayerProfile> {
        self.load_player_profile(q, true)
            .await
            .map(|(profile, _)| profile)
    }
    pub(super) async fn load_player_profile(
        &self,
        q: PlayerProfileQuery,
        use_cache: bool,
    ) -> Result<(PlayerProfile, Vec<MatchSummary>)> {
        domain::validate_key(&q.player_key)?;
        self.ready().await?;
        let epoch = self.state.read().await.workspace_epoch.clone();
        let c = self.connection.read().await.clone();
        let scope = q.queue_id.map(|n| n.to_string()).unwrap_or("all".into());
        let lock = {
            let mut locks = self.profile_locks.lock().await;
            locks.retain(|_, weak| weak.strong_count() > 0);
            let key = format!("{}:{}:{scope}", epoch, q.player_key);
            let lock = locks
                .get(&key)
                .and_then(std::sync::Weak::upgrade)
                .unwrap_or_else(|| Arc::new(Mutex::new(())));
            locks.insert(key, Arc::downgrade(&lock));
            lock
        };
        let _single = lock.lock().await;
        self.check_workspace(&epoch).await?;
        if self.connection.read().await.session_epoch != c.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        let is_current = c
            .player
            .as_ref()
            .is_some_and(|player| player.player_key == q.player_key);
        let cached: Option<String> = if use_cache && is_current {
            sqlx::query_scalar("SELECT payload FROM player_profiles WHERE player_key=? AND scope=?")
                .bind(&q.player_key)
                .bind(&scope)
                .fetch_optional(&self.pool)
                .await?
        } else {
            None
        };
        if let Some(payload) = cached {
            let mut p: PlayerProfile = serde_json::from_str(&payload)?;
            let fresh = chrono::DateTime::parse_from_rfc3339(&p.collected_at)
                .is_ok_and(|t| chrono::Utc::now().signed_duration_since(t).num_seconds() < 60);
            if fresh || c.phase != ConnectionPhase::Connected {
                if let Some(player) = storage::players(&self.pool)
                    .await?
                    .into_iter()
                    .find(|player| player.player_key == q.player_key)
                {
                    p.player = player;
                }
                return Ok((profile_champion(p, q.champion_id), vec![]));
            }
        }
        Self::online(&c)?;
        let _budget = self
            .profile_budget
            .acquire()
            .await
            .map_err(|_| AppError::new(ErrorCode::Cancelled))?;
        self.check_workspace(&epoch).await?;
        if self.connection.read().await.session_epoch != c.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        let p = self.same_region_player(&q.player_key, &c).await?;
        let ident = c
            .identification
            .as_ref()
            .ok_or(AppError::new(ErrorCode::RegionUnknown))?;
        let mut source = domain::choose_source(ident, c.sgp_ready, false, &p.server_id)?;
        let remote = self
            .remote
            .read()
            .await
            .clone()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
        let raw = match remote.recent(&p, source.clone()).await {
            Ok(v) => v,
            Err(e)
                if source == Source::Sgp
                    && c.lcu_ready
                    && matches!(
                        e.code,
                        ErrorCode::EndpointUnsupported | ErrorCode::NetworkUnavailable
                    ) =>
            {
                source = domain::choose_source(ident, false, true, &p.server_id)?;
                remote.recent(&p, source.clone()).await?
            }
            Err(e) => return Err(self.record_player_error(e, &c.session_epoch).await),
        };
        let all: Vec<_> = clients::normalize(&raw, &p, source.clone(), None)?
            .into_iter()
            .take(50)
            .collect();
        let items: Vec<_> = all
            .iter()
            .filter(|m| q.queue_id.is_none_or(|n| m.queue_id == Some(n)))
            .cloned()
            .collect();
        let rank = remote.ranks(&p).await;
        let (ranks, rank_error) = match rank {
            Ok(v) => {
                let entries = v["queues"].as_array().cloned().unwrap_or_default();
                (
                    entries
                        .iter()
                        .map(|r| RankEntry {
                            queue: r["queueType"].as_str().unwrap_or("unknown").into(),
                            tier: r["tier"]
                                .as_str()
                                .filter(|s| !s.is_empty() && *s != "NONE")
                                .map(str::to_string),
                            division: r["division"].as_str().map(str::to_string),
                            points: r["leaguePoints"].as_u64().and_then(|n| n.try_into().ok()),
                        })
                        .collect(),
                    None,
                )
            }
            Err(e) => {
                let e = self.record_player_error(e, &c.session_epoch).await;
                (vec![], Some(e.code))
            }
        };
        let mut champions = BTreeMap::<u32, Vec<MatchSummary>>::new();
        for m in &items {
            if let Some(id) = m.champion_id {
                champions.entry(id).or_default().push(m.clone())
            }
        }
        let mut profile = PlayerProfile {
            player: p,
            source,
            collected_at: storage::now(),
            ranks,
            rank_error,
            queue_id: q.queue_id,
            games: items.len() as u32,
            win_rate: win_rate(&items),
            kda: sample(
                items
                    .iter()
                    .filter(|m| m.outcome != Outcome::Remake)
                    .map(kda),
            ),
            champions: champions
                .into_iter()
                .map(|(id, games)| {
                    let w = win_rate(&games);
                    ChampionRecent {
                        champion_id: id,
                        games: games.len() as u32,
                        wins: games.iter().filter(|m| m.outcome == Outcome::Win).count() as u32,
                        decided: w.samples,
                        kda: sample(
                            games
                                .iter()
                                .filter(|m| m.outcome != Outcome::Remake)
                                .map(kda),
                        ),
                    }
                })
                .collect(),
            champion_games: 0,
            champion_win_rate: sample([]),
            champion_kda: sample([]),
        };
        profile
            .champions
            .sort_by_key(|c| std::cmp::Reverse(c.games));
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&epoch).await?;
        let current = self.connection.read().await;
        if current.session_epoch != c.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        if is_current {
            self.save_rank_snapshots(&profile).await?;
            sqlx::query("INSERT INTO player_profiles VALUES(?,?,?,?) ON CONFLICT(player_key,scope) DO UPDATE SET collected_at=excluded.collected_at,payload=excluded.payload").bind(&q.player_key).bind(scope).bind(&profile.collected_at).bind(serde_json::to_string(&profile)?).execute(&self.pool).await?;
        }
        drop(current);
        Ok((profile_champion(profile, q.champion_id), all))
    }
}
fn profile_champion(mut p: PlayerProfile, id: Option<u32>) -> PlayerProfile {
    if let Some(c) = p.champions.iter().find(|c| Some(c.champion_id) == id) {
        p.champion_games = c.games;
        p.champion_win_rate = SampleMetric {
            value: (c.decided > 0).then(|| c.wins as f64 / c.decided as f64),
            samples: c.decided,
            excluded: BTreeMap::from([("unknown_or_remake".into(), c.games - c.decided)]),
        };
        p.champion_kda = c.kda.clone();
    }
    p
}
