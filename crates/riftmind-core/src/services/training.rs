use super::*;
use crate::{domain::analysis, storage::review as db};
use sqlx::Row;
use std::collections::BTreeMap;
fn goal_state(s: &GoalState) -> &'static str {
    match s {
        GoalState::Draft => "draft",
        GoalState::Active => "active",
        GoalState::Paused => "paused",
        GoalState::Completed => "completed",
        GoalState::Abandoned => "abandoned",
    }
}
fn average(m: &[GoalMember]) -> Option<f64> {
    (m.len() >= 5).then(|| m.iter().map(|m| m.value).sum::<f64>() / m.len() as f64)
}
fn exclusion(input: &AnalysisInput, scope: Option<&GoalScope>) -> Option<&'static str> {
    let c = &input.context;
    if c.remake {
        return Some("remake");
    }
    if !analysis::supported(c) {
        return Some("mode_unsupported");
    }
    let needs_opponent = scope.is_none_or(|s| s.metric_id != "death_before_objective");
    if needs_opponent && c.duration_ms < 600000 {
        return Some("short_match");
    }
    if needs_opponent && analysis::opponent(c).is_none() {
        return Some("opponent_unreliable");
    }
    if let Some(s) = scope {
        let p = c.participants.iter().find(|p| p.id == c.target_id)?;
        if c.queue_id != Some(s.queue_id) {
            return Some("queue_mismatch");
        }
        if p.position.as_deref() != Some(&s.position) {
            return Some("position_mismatch");
        }
        if analysis::patch(&c.version) != s.patch {
            return Some("patch_mismatch");
        }
        if s.champion_id.is_some_and(|id| p.champion_id != Some(id)) {
            return Some("champion_mismatch");
        }
    }
    None
}
impl Service {
    pub(super) async fn local_reports(
        &self,
        player: &str,
    ) -> Result<Vec<(ReviewReport, AnalysisInput)>> {
        domain::validate_key(player)?;
        let rows=sqlx::query("SELECT r.payload report,json_set(i.payload,'$.frames',json('[]'),'$.events',json('[]')) input FROM reviews r JOIN analysis_inputs i ON i.id=r.input_id JOIN matches m ON m.match_key=r.match_key WHERE r.player_key=? AND r.id=(SELECT r2.id FROM reviews r2 JOIN analysis_inputs i2 ON i2.id=r2.input_id WHERE r2.match_key=r.match_key AND r2.player_key=r.player_key ORDER BY i2.revision DESC,r2.revision DESC LIMIT 1) ORDER BY m.started_at DESC,m.match_key DESC LIMIT 10000").bind(player).fetch_all(&self.pool).await?;
        rows.iter()
            .map(|r| {
                Ok((
                    serde_json::from_str(r.get("report"))?,
                    serde_json::from_str(r.get("input"))?,
                ))
            })
            .collect()
    }
    async fn samples(
        &self,
        goal: &TrainingGoal,
        baseline: bool,
    ) -> Result<(Vec<GoalMember>, BTreeMap<String, u32>)> {
        let reports = self.local_reports(&goal.scope.player_key).await?;
        let mut members = Vec::new();
        let mut excluded = BTreeMap::new();
        for (report, input) in reports {
            let started = &input.context.started_at;
            if (baseline && started >= &goal.created_at)
                || (!baseline && started <= &goal.window_start)
            {
                continue;
            }
            let reason = exclusion(&input, Some(&goal.scope)).or_else(|| {
                if !["2.1", analysis::RULES].contains(&report.rule_version.as_str()) {
                    Some("rule_mismatch")
                } else {
                    None
                }
            });
            if let Some(reason) = reason {
                *excluded.entry(reason.into()).or_default() += 1;
                continue;
            }
            let metric = report.metrics.iter().find(|m| {
                m.id == goal.scope.metric_id
                    && m.version == goal.scope.metric_version
                    && m.status == MetricStatus::Available
            });
            if let Some(value) = metric.and_then(|m| m.value) {
                if members.len() < 10 {
                    members.push(GoalMember {
                        match_key: report.match_key,
                        report_id: report.id,
                        input_fingerprint: input.fingerprint,
                        started_at: started.clone(),
                        value,
                    });
                }
            } else {
                *excluded.entry("missing_metric".into()).or_default() += 1
            }
        }
        Ok((members, excluded))
    }
    pub async fn save_goal(self: &Arc<Self>, q: SaveGoal) -> Result<TrainingGoal> {
        let _workspace = self.maintenance.read().await;
        self.check_workspace(&q.workspace_epoch).await?;
        let s = &q.scope;
        domain::validate_key(&s.player_key)?;
        if s.champion_id
            .is_some_and(|id| !super::notebooks::known_champion(id))
            || ![420, 440].contains(&s.queue_id)
            || !["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].contains(&s.position.as_str())
            || s.patch.len() > 20
            || s.patch.split('.').count() != 2
            || !s
                .patch
                .split('.')
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
            || ![
                "cs_10",
                "deaths_per_10",
                "gold_deficit_10",
                "death_before_objective",
            ]
            .contains(&s.metric_id.as_str())
            || s.metric_version != "1"
            || !["increase", "decrease"].contains(&s.direction.as_str())
            || !s.target.is_finite()
            || s.target < 0.
            || s.target > 1000.
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        if let Some(origin) = &s.origin {
            let filter = super::insights::validate_filter(origin.filter.clone())?;
            if s.champion_id.is_some()
                && filter.champion_id.is_some()
                && filter.champion_id != s.champion_id
                || filter.player_key != s.player_key
                || filter.queue_id != Some(s.queue_id)
                || filter.position.as_deref() != Some(&s.position)
                || filter.patch.as_deref() != Some(&s.patch)
                || origin.rule_id != s.metric_id
                || origin.rule_version != s.metric_version
                || origin.reports.len() > 1000
                || origin.reports.is_empty()
            {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            for link in &origin.reports {
                let summary = db::summary(
                    &self.pool,
                    &MatchRef {
                        match_key: link.match_key.clone(),
                        player_key: s.player_key.clone(),
                    },
                )
                .await?;
                if !super::insights::matches_filter(&filter, &summary) {
                    return Err(AppError::new(ErrorCode::InvalidInput));
                }
                let r = db::report(&self.pool, &link.report_id).await?;
                if r.match_key != link.match_key
                    || r.player_key != s.player_key
                    || r.input_revision != link.input_revision
                    || !r.findings.iter().any(|f| {
                        f.rule_id == origin.rule_id
                            && f.rule_version == origin.rule_version
                            && link
                                .evidence_ids
                                .iter()
                                .all(|id| f.evidence_ids.contains(id))
                    })
                {
                    return Err(AppError::new(ErrorCode::InvalidInput));
                }
            }
        }
        if ["gold_deficit_10", "death_before_objective"].contains(&s.metric_id.as_str())
            && s.target > 1.
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let old = if let Some(id) = &q.id {
            Some(
                db::json_one::<TrainingGoal>(
                    &self.pool,
                    "SELECT payload FROM training_goals WHERE id=?",
                    id,
                )
                .await?,
            )
        } else {
            None
        };
        if old.as_ref().map(|g| g.revision).unwrap_or(0) != q.expected_revision {
            return Err(db::conflict(&old));
        }
        if old
            .as_ref()
            .is_some_and(|g| g.scope.player_key != s.player_key)
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let changed = old.as_ref().is_some_and(|g| {
            serde_json::to_value(&g.scope).unwrap() != serde_json::to_value(s).unwrap()
        });
        let now = storage::now();
        let mut goal = if old.is_none() || changed {
            let mut g = TrainingGoal {
                id: uuid::Uuid::new_v4().to_string(),
                version: old.as_ref().map(|g| g.version + 1).unwrap_or(1),
                revision: 1,
                scope: q.scope,
                state: q.state,
                baseline: vec![],
                baseline_excluded: None,
                created_at: now.clone(),
                window_start: now,
                previous_goal_id: old.as_ref().map(|g| g.id.clone()),
            };
            let (members, excluded) = self.samples(&g, true).await?;
            g.baseline = members;
            g.baseline_excluded = Some(excluded);
            if g.baseline.len() < 5 {
                g.state = GoalState::Draft
            }
            g
        } else {
            let mut g = old.clone().unwrap();
            if matches!(g.state, GoalState::Completed | GoalState::Abandoned) && g.state != q.state
            {
                return Err(AppError::new(ErrorCode::InvalidInput));
            }
            if q.state == GoalState::Active && g.baseline.len() < 5 {
                let (members, excluded) = self.samples(&g, true).await?;
                g.baseline = members;
                g.baseline_excluded = Some(excluded);
                if g.baseline.len() < 5 {
                    return Err(AppError::new(ErrorCode::DataIncomplete));
                }
            }
            if g.state != GoalState::Active && q.state == GoalState::Active {
                g.window_start = now;
            }
            g.state = q.state;
            g.revision += 1;
            g
        };
        if old.is_none() && goal.state == GoalState::Paused {
            goal.state = GoalState::Draft
        }
        let mut tx = self.pool.begin().await?;
        if let Some(old) = &old {
            let current: String =
                sqlx::query_scalar("SELECT payload FROM training_goals WHERE id=?")
                    .bind(&old.id)
                    .fetch_one(&mut *tx)
                    .await?;
            let current: TrainingGoal = serde_json::from_str(&current)?;
            if current.revision != q.expected_revision {
                return Err(db::conflict(&current));
            }
            if changed {
                let mut previous = current;
                if !matches!(previous.state, GoalState::Completed | GoalState::Abandoned) {
                    previous.state = GoalState::Paused;
                }
                previous.revision += 1;
                sqlx::query("UPDATE training_goals SET state=?,revision=?,payload=? WHERE id=?")
                    .bind(goal_state(&previous.state))
                    .bind(previous.revision)
                    .bind(serde_json::to_string(&previous)?)
                    .bind(&previous.id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        sqlx::query("INSERT INTO training_goals VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,payload=excluded.payload").bind(&goal.id).bind(&goal.scope.player_key).bind(goal_state(&goal.state)).bind(goal.revision).bind(serde_json::to_string(&goal)?).execute(&mut *tx).await?;
        tx.commit().await?;
        self.emit("goals-changed", Some(goal.id.clone()), goal.revision)
            .await;
        drop(_workspace);
        if goal.state == GoalState::Active {
            self.start_evaluation(&goal.id).await?;
        }
        Ok(goal)
    }
    pub async fn list_goals(&self, q: GoalQuery) -> Result<GoalPage> {
        domain::validate_key(&q.player_key)?;
        let limit = q.limit.unwrap_or(50);
        let cursor = q.cursor.unwrap_or(0);
        if !(1..=100).contains(&limit) || cursor > 10000 {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let state = q.state.as_ref().map(goal_state);
        let rows=sqlx::query_scalar::<_,String>("SELECT payload FROM training_goals WHERE player_key=? AND (? IS NULL OR state=?) ORDER BY id LIMIT ? OFFSET ?").bind(&q.player_key).bind(state).bind(state).bind(limit+1).bind(cursor).fetch_all(&self.pool).await?;
        Ok(GoalPage {
            next_cursor: (rows.len() > limit as usize).then_some(cursor + limit),
            items: rows
                .iter()
                .take(limit as usize)
                .map(|s| serde_json::from_str(s).map_err(Into::into))
                .collect::<Result<_>>()?,
        })
    }
    pub async fn goal_progress(&self, q: GoalProgressQuery) -> Result<GoalProgress> {
        let goal = db::json_one::<TrainingGoal>(
            &self.pool,
            "SELECT payload FROM training_goals WHERE id=?",
            &q.goal_id,
        )
        .await?;
        let s:Option<String>=sqlx::query_scalar("SELECT payload FROM goal_evaluations WHERE goal_id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1").bind(&q.goal_id).bind(q.revision).bind(q.revision).fetch_optional(&self.pool).await?;
        if q.revision.is_some() && s.is_none() {
            return Err(AppError::new(ErrorCode::NotFound));
        }
        let evaluation = s
            .map(|s| serde_json::from_str::<GoalEvaluation>(&s))
            .transpose()?;
        let availability = self.goal_availability(&goal).await?;
        Ok(GoalProgress {
            frozen_baseline: average(&goal.baseline),
            goal,
            evaluation,
            availability,
        })
    }
    async fn goal_availability(&self, goal: &TrainingGoal) -> Result<GoalAvailability> {
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM match_participants WHERE player_key=?")
                .bind(&goal.scope.player_key)
                .fetch_one(&self.pool)
                .await?;
        let rows=sqlx::query("SELECT p.projection,(SELECT json_set(i.payload,'$.frames',json('[]'),'$.events',json('[]')) FROM analysis_inputs i WHERE i.match_key=p.match_key AND i.player_key=p.player_key ORDER BY revision DESC LIMIT 1) input,(SELECT r.payload FROM reviews r JOIN analysis_inputs i ON i.id=r.input_id WHERE r.match_key=p.match_key AND r.player_key=p.player_key ORDER BY i.revision DESC,r.revision DESC LIMIT 1) report FROM match_participants p JOIN matches m USING(match_key) WHERE p.player_key=? ORDER BY m.started_at DESC,m.match_key DESC LIMIT 10000").bind(&goal.scope.player_key).fetch_all(&self.pool).await?;
        let mut availability = GoalAvailability {
            scanned: rows.len() as u32,
            truncated: count > rows.len() as i64,
            missing_details: vec![],
            missing_reports: vec![],
            not_applicable: 0,
            version_mismatch: 0,
        };
        for row in rows {
            let summary: MatchSummary = serde_json::from_str(row.get("projection"))?;
            if summary.started_at <= goal.window_start
                || summary.queue_id != Some(goal.scope.queue_id)
                || summary.position.as_deref() != Some(&goal.scope.position)
                || analysis::patch(&summary.version) != goal.scope.patch
                || goal
                    .scope
                    .champion_id
                    .is_some_and(|id| summary.champion_id != Some(id))
            {
                continue;
            }
            let key = MatchRef {
                match_key: summary.match_key.clone(),
                player_key: goal.scope.player_key.clone(),
            };
            let input: Option<AnalysisInput> = row
                .get::<Option<String>, _>("input")
                .map(|payload| serde_json::from_str(&payload))
                .transpose()?;
            let report: Option<ReviewReport> = row
                .get::<Option<String>, _>("report")
                .map(|payload| serde_json::from_str(&payload))
                .transpose()?;
            if summary.outcome == Outcome::Remake {
                availability.not_applicable += 1;
            } else if input
                .as_ref()
                .is_none_or(|input| input.timeline_snapshot.is_none())
            {
                availability.missing_details.push(key);
            } else if report.is_none() {
                availability.missing_reports.push(key);
            } else if report.as_ref().is_some_and(|report| {
                !report.metrics.iter().any(|metric| {
                    metric.id == goal.scope.metric_id && metric.version == goal.scope.metric_version
                })
            }) {
                availability.version_mismatch += 1;
            } else if report.as_ref().is_some_and(|report| {
                !report.metrics.iter().any(|metric| {
                    metric.id == goal.scope.metric_id && metric.status == MetricStatus::Available
                })
            }) {
                availability.not_applicable += 1;
            }
        }
        Ok(availability)
    }
    pub(super) async fn evaluate_active(
        self: &Arc<Self>,
        player: &str,
        report_id: &str,
        epoch: &str,
    ) -> Result<()> {
        self.check_workspace(epoch).await?;
        let report = db::report(&self.pool, report_id).await?;
        let input = db::required_input(
            &self.pool,
            &MatchRef {
                match_key: report.match_key,
                player_key: report.player_key,
            },
            report.input_revision,
        )
        .await?;
        let goals:Vec<String>=sqlx::query_scalar("SELECT payload FROM training_goals WHERE player_key=? AND state='active' ORDER BY id LIMIT 100").bind(player).fetch_all(&self.pool).await?;
        for payload in goals {
            let goal: TrainingGoal = serde_json::from_str(&payload)?;
            if input.context.started_at > goal.window_start
                && exclusion(&input, Some(&goal.scope)).is_none()
                && report.metrics.iter().any(|metric| {
                    metric.id == goal.scope.metric_id
                        && metric.version == goal.scope.metric_version
                        && metric.status == MetricStatus::Available
                })
            {
                self.start_evaluation_in_workspace(&goal.id, Some(epoch))
                    .await?;
            }
        }
        Ok(())
    }
    pub async fn start_evaluation(self: &Arc<Self>, id: &str) -> Result<Task> {
        self.start_evaluation_in_workspace(id, None).await
    }
    async fn start_evaluation_in_workspace(
        self: &Arc<Self>,
        id: &str,
        epoch: Option<&str>,
    ) -> Result<Task> {
        let _workspace = self.maintenance.read().await;
        if let Some(epoch) = epoch {
            self.check_workspace(epoch).await?;
        }
        self.ready().await?;
        let goal = db::json_one::<TrainingGoal>(
            &self.pool,
            "SELECT payload FROM training_goals WHERE id=?",
            id,
        )
        .await?;
        if goal.state != GoalState::Active {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let (members, excluded) = self.samples(&goal, false).await?;
        let fingerprint = storage::hash(&serde_json::to_vec(&(
            goal.revision,
            &members,
            &excluded,
            "3",
        ))?);
        let key = format!(
            "{}|{}|{}",
            id,
            fingerprint,
            self.state.read().await.workspace_epoch
        );
        let _submit = self.submit_lock.lock().await;
        if let Some(id)=sqlx::query_scalar::<_,String>("SELECT id FROM jobs WHERE kind='evaluate_goal' AND dedupe_key=? AND state IN ('queued','running','completed') ORDER BY updated_at DESC LIMIT 1").bind(&key).fetch_optional(&self.pool).await?{return storage::task(&self.pool,&id).await}
        let task = self
            .submit_review_job(
                "evaluate_goal",
                &key,
                &goal.scope.player_key,
                serde_json::to_value(IdInput { id: id.into() })?,
                &self.state.read().await.workspace_epoch,
                None,
            )
            .await?;
        let t = task.clone();
        let service = self.clone();
        tokio::spawn(async move {
            let _op = service.operations.read().await;
            let _single = service.review_lock.lock().await;
            let result: Result<String> = async {
                service.local_checkpoint(&t).await?;
                service.job_stage(&t, "evaluate", 0).await?;
                let baseline = average(&goal.baseline);
                let current = average(&members);
                let achieved = current.map(|v| {
                    if goal.scope.direction == "increase" {
                        v >= goal.scope.target
                    } else {
                        v <= goal.scope.target
                    }
                });
                let _workspace = service.maintenance.read().await;
                service.local_checkpoint(&t).await?;
                let mut tx = service.pool.begin().await?;
                let latest: String =
                    sqlx::query_scalar("SELECT payload FROM training_goals WHERE id=?")
                        .bind(&goal.id)
                        .fetch_one(&mut *tx)
                        .await?;
                let latest: TrainingGoal = serde_json::from_str(&latest)?;
                if latest.revision != goal.revision || latest.state != GoalState::Active {
                    return Err(AppError::new(ErrorCode::Cancelled));
                }
                if let Some(id) = sqlx::query_scalar::<_, String>(
                    "SELECT id FROM goal_evaluations WHERE goal_id=? AND fingerprint=?",
                )
                .bind(&goal.id)
                .bind(&fingerprint)
                .fetch_optional(&mut *tx)
                .await?
                {
                    service.finish_job_tx(&mut tx, &t, &id).await?;
                    tx.commit().await?;
                    return Ok(id);
                }
                let revision = sqlx::query_scalar::<_, i64>(
                    "SELECT COALESCE(MAX(revision),0)+1 FROM goal_evaluations WHERE goal_id=?",
                )
                .bind(&goal.id)
                .fetch_one(&mut *tx)
                .await? as u32;
                let eval = GoalEvaluation {
                    id: uuid::Uuid::new_v4().to_string(),
                    goal_id: goal.id.clone(),
                    revision,
                    algorithm_version: "3".into(),
                    baseline,
                    current,
                    delta: current.zip(baseline).map(|(a, b)| a - b),
                    target: goal.scope.target,
                    achieved,
                    window_start: goal.window_start.clone(),
                    window_end: members.first().map(|m| m.started_at.clone()),
                    members,
                    excluded,
                    generated_at: storage::now(),
                };
                sqlx::query("INSERT INTO goal_evaluations VALUES(?,?,?,?,?)")
                    .bind(&eval.id)
                    .bind(&goal.id)
                    .bind(revision)
                    .bind(fingerprint)
                    .bind(serde_json::to_string(&eval)?)
                    .execute(&mut *tx)
                    .await?;
                service.finish_job_tx(&mut tx, &t, &eval.id).await?;
                tx.commit().await?;
                Ok(eval.id)
            }
            .await;
            let _workspace = service.maintenance.read().await;
            if service.state.read().await.workspace_epoch != t.session_epoch {
                return;
            }
            service.finish_job(&t, result).await;
            service.emit("goals-changed", Some(goal.id), 0).await;
        });
        Ok(task)
    }
    pub async fn player_progress(&self, mut q: PlayerProgressQuery) -> Result<PlayerProgress> {
        domain::validate_key(&q.player_key)?;
        if q.position.as_ref().is_some_and(|s| s.len() > 30)
            || q.patch.as_ref().is_some_and(|s| s.len() > 20)
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        for date in [&mut q.from, &mut q.to] {
            if let Some(value) = date.as_ref() {
                if value.len() > 40 {
                    return Err(AppError::new(ErrorCode::InvalidInput));
                }
                let parsed = chrono::DateTime::parse_from_rfc3339(value)
                    .map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
                *date = Some(
                    parsed
                        .with_timezone(&chrono::Utc)
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                );
            }
        }
        if q.from
            .as_ref()
            .zip(q.to.as_ref())
            .is_some_and(|(a, b)| a > b)
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let cached_matches = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM match_participants WHERE player_key=?",
        )
        .bind(&q.player_key)
        .fetch_one(&self.pool)
        .await? as u32;
        let mut points = Vec::new();
        let mut excluded = BTreeMap::new();
        let rows = self.local_reports(&q.player_key).await?;
        let report_count = rows.len() as u32;
        excluded.insert(
            "no_report".into(),
            cached_matches.saturating_sub(report_count),
        );
        for (r, i) in rows {
            let c = &i.context;
            let p = c.participants.iter().find(|p| p.id == c.target_id).unwrap();
            if q.queue_id.is_some_and(|id| c.queue_id != Some(id))
                || q.position
                    .as_ref()
                    .is_some_and(|s| p.position.as_ref() != Some(s))
                || q.patch
                    .as_ref()
                    .is_some_and(|s| analysis::patch(&c.version) != *s)
                || q.from.as_ref().is_some_and(|s| c.started_at < *s)
                || q.to.as_ref().is_some_and(|s| c.started_at > *s)
            {
                *excluded.entry("filtered".into()).or_default() += 1;
                continue;
            }
            if let Some(reason) = exclusion(&i, None) {
                *excluded.entry(reason.into()).or_default() += 1;
                continue;
            }
            if points.len() >= 200 {
                *excluded.entry("outside_display_window".into()).or_default() += 1;
                continue;
            }
            points.push(TrendPoint {
                match_key: r.match_key,
                report_id: r.id,
                started_at: c.started_at.clone(),
                group: format!(
                    "{}:{}:{}:{}",
                    c.queue_id.unwrap_or(0),
                    p.position.clone().unwrap_or_default(),
                    analysis::patch(&c.version),
                    r.rule_version
                ),
                metrics: r
                    .metrics
                    .into_iter()
                    .filter(|m| ["cs_10", "deaths_per_10", "cs_per_min"].contains(&m.id.as_str()))
                    .collect(),
            });
        }
        let from = points.last().map(|p| p.started_at.clone());
        let to = points.first().map(|p| p.started_at.clone());
        Ok(PlayerProgress {
            points,
            excluded,
            cached_matches,
            from,
            to,
        })
    }
}
