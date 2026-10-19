use super::*;

impl Service {
    pub async fn match_scoreboard(&self, key: MatchRef) -> Result<Option<MatchScoreboard>> {
        self.ready().await?;
        let epoch = self.state.read().await.workspace_epoch.clone();
        let summary = match storage::review::summary(&self.pool, &key).await {
            Ok(summary) => summary,
            Err(error) if error.code == ErrorCode::NotFound => {
                return self.recent_match_scoreboard(&key).await.map(Some);
            }
            Err(error) => return Err(error),
        };
        let raw = if let Some(input) = storage::review::input(&self.pool, &key, None).await? {
            Some(storage::review::snapshot(&self.pool, &input.summary_snapshot).await?)
        } else {
            storage::review::cached_summary(&self.pool, &summary).await?
        };
        let scoreboard = raw
            .map(|raw| domain::match_scoreboard::normalize(&raw, &summary))
            .transpose()?;
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&epoch).await?;
        if let Some(scoreboard) = &scoreboard {
            self.save_scoreboard_players(scoreboard, &summary).await?;
        }
        Ok(scoreboard)
    }

    async fn save_scoreboard_players(
        &self,
        scoreboard: &MatchScoreboard,
        summary: &MatchSummary,
    ) -> Result<()> {
        let mut transaction = self.pool.begin().await?;
        let mut inserted = false;
        for participant in &scoreboard.participants {
            let Some(key) = participant.player_key.as_deref() else {
                continue;
            };
            let Some((server, puuid)) = key.split_once(':') else {
                continue;
            };
            if server != summary.server_id || puuid.is_empty() || domain::validate_key(key).is_err()
            {
                continue;
            }
            // Historical identities must not overwrite newer names, icons or levels.
            inserted |= sqlx::query(
                "INSERT INTO players (player_key,server_id,puuid,display_name,updated_at) \
                 VALUES(?,?,?,?,?) ON CONFLICT(player_key) DO NOTHING",
            )
            .bind(key)
            .bind(server)
            .bind(puuid)
            .bind(participant.display_name.as_deref().unwrap_or_default())
            .bind(&summary.started_at)
            .execute(&mut *transaction)
            .await?
            .rows_affected()
                > 0;
        }
        transaction.commit().await?;
        if inserted {
            self.emit("players-changed", None, 0).await;
        }
        Ok(())
    }

    async fn recent_match_scoreboard(&self, key: &MatchRef) -> Result<MatchScoreboard> {
        let epoch = self.state.read().await.workspace_epoch.clone();
        let connection = self.connection.read().await.clone();
        match connection.phase {
            ConnectionPhase::Connected => {}
            ConnectionPhase::WaitingAuth => return Err(AppError::new(ErrorCode::WaitingAuth)),
            ConnectionPhase::CoolingDown => return Err(AppError::new(ErrorCode::RateLimited)),
            _ => return Err(AppError::new(ErrorCode::ClientNotFound)),
        }
        let player = self
            .same_region_player(&key.player_key, &connection)
            .await?;
        if !key.match_key.starts_with(&format!("{}:", player.server_id)) {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
        let identification = connection
            .identification
            .as_ref()
            .ok_or(AppError::new(ErrorCode::RegionUnknown))?;
        let mut source = domain::choose_source(
            identification,
            connection.sgp_ready,
            false,
            &player.server_id,
        )?;
        let remote = self
            .remote
            .read()
            .await
            .clone()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?;
        let _permit = self
            .detail_lock
            .acquire()
            .await
            .map_err(|_| AppError::new(ErrorCode::Cancelled))?;
        let recent = match remote.recent(&player, source.clone()).await {
            Ok(recent) => recent,
            Err(error)
                if source == Source::Sgp
                    && connection.lcu_ready
                    && matches!(
                        error.code,
                        ErrorCode::EndpointUnsupported | ErrorCode::NetworkUnavailable
                    ) =>
            {
                source = domain::choose_source(identification, false, true, &player.server_id)?;
                remote.recent(&player, source.clone()).await?
            }
            Err(error) => {
                return Err(self
                    .record_player_error(error, &connection.session_epoch)
                    .await);
            }
        };
        let mut summary = clients::normalize(&recent, &player, source.clone(), None)?
            .into_iter()
            .take(50)
            .find(|summary| summary.match_key == key.match_key)
            .ok_or(AppError::new(ErrorCode::NotFound))?;
        let raw = match remote.single(&summary, false, source.clone()).await {
            Ok(raw) => raw,
            Err(error)
                if source == Source::Sgp
                    && connection.lcu_ready
                    && matches!(
                        error.code,
                        ErrorCode::EndpointUnsupported | ErrorCode::NetworkUnavailable
                    ) =>
            {
                source = domain::choose_source(identification, false, true, &player.server_id)?;
                remote.single(&summary, false, source.clone()).await?
            }
            Err(error) => {
                return Err(self
                    .record_player_error(error, &connection.session_epoch)
                    .await);
            }
        };
        summary.source = source;
        let scoreboard = domain::match_scoreboard::normalize(&raw, &summary)?;
        if scoreboard.target_id.is_none() {
            return Err(AppError::new(ErrorCode::DataIncomplete));
        }
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&epoch).await?;
        let current = self.connection.read().await;
        if current.session_epoch != connection.session_epoch {
            return Err(AppError::new(ErrorCode::SessionChanged));
        }
        self.save_scoreboard_players(&scoreboard, &summary).await?;
        // Visiting a room member's history is read-only; it never creates local match records.
        Ok(scoreboard)
    }
}
