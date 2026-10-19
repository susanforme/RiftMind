use super::*;
use crate::{domain::analysis, storage::review as db};
use sqlx::Row;

pub fn quantile(sorted: &[f64], fraction: f64) -> f64 {
    let position = (sorted.len() - 1) as f64 * fraction;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower as f64)
}
fn rounded(value: f64) -> f64 {
    (value * 1000.).round() / 1000.
}
fn resource_event(event: &TimelineEvent) -> bool {
    ["ELITE_MONSTER_KILL", "BUILDING_KILL"].contains(&event.kind.as_str())
}
impl Service {
    pub async fn event_context(&self, query: EventContextQuery) -> Result<ReviewEventContext> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        if query.radius_ms > 600_000
            || !["death", "objective", "all"].contains(&query.category.as_str())
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let report = db::report(&self.pool, &query.report_id).await?;
        let key = MatchRef {
            match_key: report.match_key.clone(),
            player_key: report.player_key.clone(),
        };
        let input = db::required_input(&self.pool, &key, report.input_revision).await?;
        let mut anchors: Vec<_> = input
            .events
            .iter()
            .filter(|event| {
                query.category == "all"
                    || (query.category == "death"
                        && event.kind == "CHAMPION_KILL"
                        && event.victim_id == Some(input.context.target_id))
                    || (query.category == "objective" && resource_event(event))
            })
            .collect();
        anchors.sort_by(|left, right| {
            (left.timestamp_ms, &left.id).cmp(&(right.timestamp_ms, &right.id))
        });
        let focus = if let Some(id) = query.event_id {
            Some(
                anchors
                    .iter()
                    .find(|event| event.id == id)
                    .ok_or(AppError::new(ErrorCode::EvidenceUnavailable))?
                    .to_owned()
                    .clone(),
            )
        } else {
            query
                .at_ms
                .and_then(|at| {
                    anchors
                        .iter()
                        .min_by_key(|event| event.timestamp_ms.abs_diff(at))
                        .copied()
                })
                .or_else(|| anchors.first().copied())
                .cloned()
        };
        let at = query
            .at_ms
            .or_else(|| focus.as_ref().map(|event| event.timestamp_ms))
            .unwrap_or(0)
            .min(input.context.duration_ms);
        let from_ms = at.saturating_sub(query.radius_ms);
        let to_ms = at
            .saturating_add(query.radius_ms)
            .min(input.context.duration_ms);
        let anchor = focus
            .as_ref()
            .and_then(|focus| anchors.iter().position(|event| event.id == focus.id));
        let previous_id = anchor
            .and_then(|index| index.checked_sub(1))
            .map(|index| anchors[index].id.clone());
        let next_id = anchor
            .and_then(|index| anchors.get(index + 1))
            .map(|event| event.id.clone());
        let events: Vec<_> = input
            .events
            .iter()
            .filter(|event| event.timestamp_ms >= from_ms && event.timestamp_ms <= to_ms)
            .cloned()
            .collect();
        let own_team = input
            .context
            .participants
            .iter()
            .find(|participant| participant.id == input.context.target_id)
            .map(|participant| participant.team_id);
        let involved = focus
            .as_ref()
            .map(|event| {
                let mut ids = event.assisting_ids.clone();
                ids.extend(event.killer_id);
                ids
            })
            .unwrap_or_default();
        let enemies: Vec<_> = input
            .context
            .participants
            .iter()
            .filter(|participant| own_team.is_some_and(|team| participant.team_id != team))
            .collect();
        let reliable_positions = enemies.len() == 5
            && enemies.iter().all(|participant| {
                participant.position.as_deref().is_some_and(|position| {
                    ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].contains(&position)
                })
            })
            && enemies
                .iter()
                .map(|participant| &participant.position)
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                == 5;
        let enemy_jungler_ids = input
            .context
            .participants
            .iter()
            .filter(|participant| {
                reliable_positions
                    && own_team.is_some_and(|team| participant.team_id != team)
                    && participant.position.as_deref() == Some("JUNGLE")
                    && involved.contains(&participant.id)
            })
            .map(|participant| participant.id)
            .collect();
        let evidence_ids = report
            .evidence
            .iter()
            .filter(|evidence| {
                evidence
                    .timestamp_ms
                    .is_some_and(|timestamp| timestamp >= from_ms && timestamp <= to_ms)
            })
            .map(|evidence| evidence.id.clone())
            .collect();
        let chart = self
            .match_metrics(ChartQuery {
                match_key: report.match_key.clone(),
                player_key: report.player_key.clone(),
                input_revision: report.input_revision,
                from_ms,
                to_ms,
                max_points: 400,
            })
            .await?;
        Ok(ReviewEventContext {
            report_id: report.id,
            input_revision: report.input_revision,
            focus,
            previous_id,
            next_id,
            from_ms,
            to_ms,
            events,
            participants: input.context.participants,
            enemy_jungler_ids,
            capabilities: input.capabilities,
            evidence_ids,
            chart,
        })
    }
    pub async fn personal_baseline(
        &self,
        query: PersonalBaselineQuery,
    ) -> Result<PersonalBaseline> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&query.workspace_epoch).await?;
        let current = db::report(&self.pool, &query.report_id).await?;
        if !query.refresh {
            let payload:Option<String>=sqlx::query_scalar("SELECT payload FROM personal_baselines WHERE report_id=? AND all_champions=? ORDER BY rowid DESC LIMIT 1").bind(&query.report_id).bind(query.all_champions).fetch_optional(&self.pool).await?;
            if let Some(payload) = payload {
                return Ok(serde_json::from_str(&payload)?);
            }
        }
        let current_summary = db::summary(
            &self.pool,
            &MatchRef {
                match_key: current.match_key.clone(),
                player_key: current.player_key.clone(),
            },
        )
        .await?;
        let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM match_participants p JOIN matches m USING(match_key) WHERE p.player_key=? AND m.started_at<? AND p.match_key<>?").bind(&current.player_key).bind(&current_summary.started_at).bind(&current.match_key).fetch_one(&self.pool).await?;
        let rows=sqlx::query("SELECT p.projection,(SELECT r.payload FROM reviews r JOIN analysis_inputs i ON i.id=r.input_id WHERE r.match_key=p.match_key AND r.player_key=p.player_key ORDER BY i.revision DESC,r.revision DESC LIMIT 1) report FROM match_participants p JOIN matches m USING(match_key) WHERE p.player_key=? AND m.started_at<? AND p.match_key<>? ORDER BY m.started_at DESC,m.match_key DESC LIMIT 10000").bind(&current.player_key).bind(&current_summary.started_at).bind(&current.match_key).fetch_all(&self.pool).await?;
        let mut metrics = Vec::new();
        for metric_id in [
            "cs_10",
            "cs_15",
            "gold_diff_10",
            "gold_diff_15",
            "cs_per_min",
            "deaths_per_10",
        ] {
            let current_metric = current.metrics.iter().find(|metric| metric.id == metric_id);
            let mut metric = BaselineMetric {
                id: metric_id.into(),
                version: current_metric
                    .map(|metric| metric.version.clone())
                    .unwrap_or("1".into()),
                unit: current_metric
                    .map(|metric| metric.unit.clone())
                    .unwrap_or_default(),
                current: current_metric
                    .filter(|metric| metric.status == MetricStatus::Available)
                    .and_then(|metric| metric.value)
                    .filter(|value| value.is_finite()),
                count: 0,
                median: None,
                lower_quartile: None,
                upper_quartile: None,
                delta: None,
                samples: Vec::new(),
            };
            let mut values = Vec::new();
            for row in &rows {
                let summary: MatchSummary = serde_json::from_str(row.get("projection"))?;
                let report: Option<ReviewReport> = row
                    .get::<Option<String>, _>("report")
                    .map(|payload| serde_json::from_str(&payload))
                    .transpose()?;
                let candidate = report
                    .as_ref()
                    .and_then(|report| report.metrics.iter().find(|metric| metric.id == metric_id));
                let reason = if summary.outcome == Outcome::Remake {
                    Some("remake")
                } else if summary.queue_id != current_summary.queue_id {
                    Some("queue_mismatch")
                } else if !["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]
                    .contains(&summary.position.as_deref().unwrap_or(""))
                    || summary.position != current_summary.position
                {
                    Some("position_mismatch")
                } else if analysis::patch(&summary.version)
                    != analysis::patch(&current_summary.version)
                {
                    Some("patch_mismatch")
                } else if !query.all_champions && summary.champion_id != current_summary.champion_id
                {
                    Some("champion_mismatch")
                } else if report.is_none() {
                    Some("no_report")
                } else if candidate.is_none() {
                    Some("missing_metric")
                } else if candidate.is_some_and(|candidate| {
                    candidate.version != metric.version || candidate.unit != metric.unit
                }) {
                    Some("metric_version_mismatch")
                } else if candidate.is_some_and(|candidate| {
                    candidate.status != MetricStatus::Available
                        || candidate.value.is_none_or(|value| !value.is_finite())
                }) {
                    Some("missing_metric")
                } else if values.len() >= 20 {
                    Some("outside_sample_window")
                } else {
                    None
                };
                let value = candidate
                    .and_then(|candidate| candidate.value)
                    .filter(|value| value.is_finite());
                if reason.is_none() {
                    values.push(value.unwrap());
                }
                metric.samples.push(BaselineSample {
                    match_key: summary.match_key,
                    report_id: report.as_ref().map(|report| report.id.clone()),
                    input_revision: report.map(|report| report.input_revision),
                    value,
                    reason: reason.map(str::to_string),
                });
            }
            metric.count = values.len() as u32;
            if values.len() >= 5 {
                values.sort_by(f64::total_cmp);
                let median = quantile(&values, 0.5);
                metric.median = Some(rounded(median));
                metric.lower_quartile = Some(rounded(quantile(&values, 0.25)));
                metric.upper_quartile = Some(rounded(quantile(&values, 0.75)));
                metric.delta = metric.current.map(|current| rounded(current - median));
            }
            metrics.push(metric);
        }
        let baseline = PersonalBaseline {
            id: uuid::Uuid::new_v4().to_string(),
            report_id: query.report_id,
            all_champions: query.all_champions,
            algorithm_version: "personal-history-1:type7:round3:recent20:min5:scan10000".into(),
            scanned: rows.len() as u32,
            truncated: count > rows.len() as i64,
            metrics,
            created_at: storage::now(),
        };
        sqlx::query("INSERT INTO personal_baselines VALUES(?,?,?,?,?)")
            .bind(&baseline.id)
            .bind(&baseline.report_id)
            .bind(baseline.all_champions)
            .bind(&baseline.created_at)
            .bind(serde_json::to_string(&baseline)?)
            .execute(&self.pool)
            .await?;
        Ok(baseline)
    }
}

pub async fn validate_saved_insights(pool: &SqlitePool) -> Result<()> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT payload FROM personal_baselines")
        .fetch_all(pool)
        .await?;
    for payload in rows {
        let baseline: PersonalBaseline = serde_json::from_str(&payload)?;
        let current = db::report(pool, &baseline.report_id).await?;
        for metric in baseline.metrics {
            if metric.count > 20 || metric.samples.len() > 10000 {
                return Err(AppError::new(ErrorCode::BackupInvalid));
            }
            for sample in metric.samples {
                if let Some(id) = sample.report_id {
                    let report = db::report(pool, &id).await?;
                    if report.match_key != sample.match_key
                        || report.player_key != current.player_key
                        || Some(report.input_revision) != sample.input_revision
                    {
                        return Err(AppError::new(ErrorCode::BackupInvalid));
                    }
                }
            }
        }
    }
    let rows: Vec<String> = sqlx::query_scalar("SELECT payload FROM preparation_batches")
        .fetch_all(pool)
        .await?;
    for payload in rows {
        let batch: PreparationBatch = serde_json::from_str(&payload)?;
        if batch.members.is_empty() || batch.members.len() > 20 {
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
        for member in batch.members {
            let _ = db::summary(
                pool,
                &MatchRef {
                    match_key: member.match_key.clone(),
                    player_key: batch.player_key.clone(),
                },
            )
            .await?;
            if let Some(id) = member.report_id {
                let report = db::report(pool, &id).await?;
                if report.match_key != member.match_key
                    || report.player_key != batch.player_key
                    || Some(report.input_revision) != member.input_revision
                {
                    return Err(AppError::new(ErrorCode::BackupInvalid));
                }
            }
        }
    }
    Ok(())
}
