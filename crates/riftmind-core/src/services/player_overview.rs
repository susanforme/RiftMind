use super::players::{kda, sample, win_rate};
use super::*;
use std::collections::BTreeMap;

impl Service {
    pub(super) async fn save_rank_snapshots(&self, profile: &PlayerProfile) -> Result<()> {
        let mut transaction = self.pool.begin().await?;
        for rank in &profile.ranks {
            let payload = serde_json::to_string(rank)?;
            let previous: Option<(String, String)> = sqlx::query_as(
                "SELECT collected_at,payload FROM rank_snapshots WHERE player_key=? AND queue=? ORDER BY collected_at DESC LIMIT 1"
            ).bind(&profile.player.player_key).bind(&rank.queue).fetch_optional(&mut *transaction).await?;
            let unchanged = previous.is_some_and(|(timestamp, previous_payload)| {
                previous_payload == payload
                    && chrono::DateTime::parse_from_rfc3339(&timestamp).is_ok_and(|time| {
                        chrono::Utc::now().signed_duration_since(time).num_hours() < 6
                    })
            });
            if !unchanged {
                sqlx::query("INSERT OR IGNORE INTO rank_snapshots VALUES(?,?,?,?)")
                    .bind(&profile.player.player_key)
                    .bind(&rank.queue)
                    .bind(&profile.collected_at)
                    .bind(payload)
                    .execute(&mut *transaction)
                    .await?;
            }
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn player_overview(&self, query: PlayerOverviewQuery) -> Result<PlayerOverview> {
        self.ready().await?;
        domain::validate_key(&query.player_key)?;
        if query.days.is_some_and(|days| ![30, 90].contains(&days)) {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let epoch = self.state.read().await.workspace_epoch.clone();
        let connection = self.connection.read().await.clone();
        let is_self: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM local_accounts WHERE player_key=?)")
                .bind(&query.player_key)
                .fetch_one(&self.pool)
                .await?;
        let is_current = connection
            .player
            .as_ref()
            .is_some_and(|player| player.player_key == query.player_key);
        let mut history_error = None;
        let remote = if is_current || !is_self {
            match self
                .load_player_profile(
                    PlayerProfileQuery {
                        player_key: query.player_key.clone(),
                        queue_id: query.queue_id,
                        champion_id: None,
                    },
                    false,
                )
                .await
            {
                Ok(result) => Some(result),
                Err(error)
                    if is_self
                        && !matches!(
                            error.code,
                            ErrorCode::SessionChanged | ErrorCode::RegionConflict
                        ) =>
                {
                    history_error = Some(error.code);
                    None
                }
                Err(error) => return Err(error),
            }
        } else {
            None
        };
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&epoch).await?;
        let current = self.connection.read().await;
        if current.session_epoch != connection.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        let mut rank_history = vec![];
        let mut matches = if is_self {
            let projections: Vec<String> =
                sqlx::query_scalar("SELECT projection FROM match_participants WHERE player_key=?")
                    .bind(&query.player_key)
                    .fetch_all(&self.pool)
                    .await?;
            projections
                .into_iter()
                .map(|projection| serde_json::from_str::<MatchSummary>(&projection))
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            vec![]
        };
        let mut profile = if let Some((profile, recent)) = remote {
            // The latest remote projection wins; the visitor's matches never enter SQLite.
            let mut by_key: BTreeMap<String, MatchSummary> = matches
                .into_iter()
                .map(|summary| (summary.match_key.clone(), summary))
                .collect();
            for summary in recent {
                by_key.insert(summary.match_key.clone(), summary);
            }
            matches = by_key.into_values().collect();
            profile
        } else {
            let player = storage::players(&self.pool)
                .await?
                .into_iter()
                .find(|player| player.player_key == query.player_key)
                .ok_or(AppError::new(ErrorCode::NotFound))?;
            PlayerProfile {
                player,
                source: Source::Lcu,
                collected_at: storage::now(),
                ranks: vec![],
                rank_error: history_error.clone(),
                queue_id: query.queue_id,
                games: 0,
                win_rate: sample([]),
                kda: sample([]),
                champions: vec![],
                champion_games: 0,
                champion_win_rate: sample([]),
                champion_kda: sample([]),
            }
        };
        if is_self {
            let snapshots: Vec<(String, String)> = sqlx::query_as("SELECT collected_at,payload FROM rank_snapshots WHERE player_key=? ORDER BY collected_at,queue")
                .bind(&query.player_key).fetch_all(&self.pool).await?;
            for (collected_at, payload) in snapshots {
                rank_history.push(RankSnapshot {
                    collected_at,
                    rank: serde_json::from_str(&payload)?,
                });
            }
            if profile.ranks.is_empty() {
                let mut latest = BTreeMap::new();
                for snapshot in &rank_history {
                    latest.insert(snapshot.rank.queue.clone(), snapshot.rank.clone());
                }
                profile.ranks = latest.into_values().collect();
            }
        }
        let cutoff = if is_self {
            query
                .days
                .map(|days| (chrono::Utc::now() - chrono::Duration::days(days.into())).to_rfc3339())
        } else {
            None
        };
        matches.retain(|summary| {
            query
                .queue_id
                .is_none_or(|queue| summary.queue_id == Some(queue))
                && cutoff
                    .as_ref()
                    .is_none_or(|cutoff| summary.started_at >= *cutoff)
        });
        matches.sort_by(|left, right| {
            right
                .started_at
                .cmp(&left.started_at)
                .then_with(|| right.match_key.cmp(&left.match_key))
        });
        if !is_self {
            matches.truncate(50);
        }
        rank_history.retain(|snapshot| {
            cutoff
                .as_ref()
                .is_none_or(|cutoff| snapshot.collected_at >= *cutoff)
        });
        profile.games = matches.len() as u32;
        profile.win_rate = win_rate(&matches);
        profile.kda = sample(
            matches
                .iter()
                .filter(|summary| summary.outcome != Outcome::Remake)
                .map(kda),
        );
        let mut champions: BTreeMap<u32, Vec<MatchSummary>> = BTreeMap::new();
        for summary in &matches {
            if let Some(champion) = summary.champion_id {
                champions.entry(champion).or_default().push(summary.clone());
            }
        }
        profile.champions = champions
            .into_iter()
            .map(|(champion_id, games)| ChampionRecent {
                champion_id,
                games: games.len() as u32,
                wins: games
                    .iter()
                    .filter(|summary| summary.outcome == Outcome::Win)
                    .count() as u32,
                decided: win_rate(&games).samples,
                kda: sample(
                    games
                        .iter()
                        .filter(|summary| summary.outcome != Outcome::Remake)
                        .map(kda),
                ),
            })
            .collect();
        profile
            .champions
            .sort_by_key(|champion| (std::cmp::Reverse(champion.games), champion.champion_id));
        Ok(PlayerOverview {
            profile,
            matches,
            rank_history,
            is_self,
            history_error,
        })
    }
}
