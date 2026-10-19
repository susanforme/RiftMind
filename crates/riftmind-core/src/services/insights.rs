use super::players::{kda, sample, win_rate};
use super::*;
use crate::{domain::analysis, storage::review as db};
use sqlx::Row;
use std::collections::BTreeMap;
pub fn validate_filter(mut f: AnalysisFilter) -> Result<AnalysisFilter> {
    domain::validate_key(&f.player_key)?;
    if f.position.as_ref().is_some_and(|s| {
        !(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY", "UNKNOWN"].contains(&s.as_str()))
    }) || f.patch.as_ref().is_some_and(|s| {
        s.len() > 20 || s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit() || b == b'.')
    }) {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    for s in [&mut f.from, &mut f.to].into_iter().flatten() {
        let d = chrono::DateTime::parse_from_rfc3339(s)
            .map_err(|_| AppError::new(ErrorCode::InvalidInput))?;
        *s = d
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    }
    if f.from
        .as_ref()
        .zip(f.to.as_ref())
        .is_some_and(|(a, b)| a > b)
    {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    Ok(f)
}
pub fn matches_filter(f: &AnalysisFilter, m: &MatchSummary) -> bool {
    f.queue_id.is_none_or(|id| m.queue_id == Some(id))
        && f.champion_id.is_none_or(|id| m.champion_id == Some(id))
        && f.position.as_ref().is_none_or(|p| {
            m.position
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("UNKNOWN")
                == p
        })
        && f.patch
            .as_ref()
            .is_none_or(|p| analysis::patch(&m.version) == *p)
        && f.from.as_ref().is_none_or(|s| m.started_at >= *s)
        && f.to.as_ref().is_none_or(|s| m.started_at <= *s)
}
fn window(cursor: Option<u32>, limit: Option<u32>) -> Result<(usize, usize)> {
    let (c, l) = (cursor.unwrap_or(0), limit.unwrap_or(50));
    if c > 10000 || !(1..=100).contains(&l) {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    Ok((c as usize, l as usize))
}
impl Service {
    async fn comparison_metrics(&self, d: &ReviewData) -> Result<Vec<MetricResult>> {
        if let Some(r) = &d.report {
            return Ok(r.metrics.clone());
        }
        if let Some(i) = &d.input {
            let full = db::required_input(
                &self.pool,
                &MatchRef {
                    match_key: d.summary.match_key.clone(),
                    player_key: d.summary.player_key.clone(),
                },
                i.revision,
            )
            .await?;
            return Ok(analysis::metrics(&full));
        }
        Ok(vec![])
    }

    pub async fn champion_pool(&self, q: ChampionQuery) -> Result<ChampionPool> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        let mut f = validate_filter(q.filter)?;
        let queue_ids = q
            .queue_ids
            .unwrap_or_else(|| vec![f.queue_id.unwrap_or(420)]);
        if queue_ids.len() > 32 || queue_ids.iter().any(|id| *id == 0 || *id >= 1_000_000) {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        f.queue_id = None;
        let (cursor, limit) = window(q.cursor, q.limit)?;
        if !["games", "win_rate", "kda", "cs_per_min", "damage_share"].contains(&q.sort.as_str()) {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let cached: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM match_participants WHERE player_key=?")
                .bind(&f.player_key)
                .fetch_one(&self.pool)
                .await?;
        let rows=sqlx::query("SELECT p.projection,(SELECT json_set(i.payload,'$.frames',json('[]'),'$.events',json('[]')) FROM analysis_inputs i WHERE i.match_key=p.match_key AND i.player_key=p.player_key ORDER BY i.revision DESC LIMIT 1) input FROM match_participants p JOIN matches m USING(match_key) WHERE p.player_key=? ORDER BY m.started_at DESC,m.match_key DESC LIMIT 10000").bind(&f.player_key).fetch_all(&self.pool).await?;
        let mut by_champion =
            BTreeMap::<Option<u32>, Vec<(MatchSummary, Option<AnalysisInput>)>>::new();
        let mut starts = Vec::new();
        for row in rows {
            let m: MatchSummary = serde_json::from_str(row.get("projection"))?;
            if m.outcome == Outcome::Remake
                || (!queue_ids.is_empty() && !m.queue_id.is_some_and(|id| queue_ids.contains(&id)))
                || !matches_filter(&f, &m)
            {
                continue;
            }
            starts.push(m.started_at.clone());
            let input = row
                .get::<Option<String>, _>("input")
                .map(|s| serde_json::from_str(&s))
                .transpose()?;
            by_champion
                .entry(m.champion_id)
                .or_default()
                .push((m, input));
        }
        let filtered = starts.len() as u32;
        let mut items = Vec::new();
        for (id, rows) in by_champion {
            let all: Vec<_> = rows.iter().map(|(m, _)| m.clone()).collect();
            let valid: Vec<_> = rows.iter().collect();
            let field = |name: &str| {
                sample(valid.iter().map(|(_, i)| {
                    i.as_ref().and_then(|i| {
                        analysis::metrics(i)
                            .into_iter()
                            .find(|m| {
                                m.id == name
                                    && m.version == "1"
                                    && m.status == MetricStatus::Available
                            })
                            .and_then(|m| m.value)
                    })
                }))
            };
            let mut k = sample(valid.iter().map(|(m, _)| kda(m)));
            let zeros = valid.iter().filter(|(m, _)| m.deaths == Some(0)).count() as u32;
            if zeros > 0 {
                let missing = k.excluded.entry("missing".into()).or_default();
                *missing = missing.saturating_sub(zeros);
                k.excluded.insert("zero_denominator".into(), zeros);
            }
            let stats = ChampionStats {
                champion_id: id,
                games: rows.len() as u32,
                win_rate: win_rate(&all),
                kills: sample(valid.iter().map(|(m, _)| m.kills.map(f64::from))),
                deaths: sample(valid.iter().map(|(m, _)| m.deaths.map(f64::from))),
                assists: sample(valid.iter().map(|(m, _)| m.assists.map(f64::from))),
                kda: k,
                cs_per_min: field("cs_per_min"),
                damage_share: field("damage_share"),
                trend: all
                    .iter()
                    .take(20)
                    .map(|m| ChampionTrend {
                        match_key: m.match_key.clone(),
                        started_at: m.started_at.clone(),
                        outcome: m.outcome.clone(),
                        group: format!(
                            "{}:{}:{}",
                            m.queue_id
                                .map(|n| n.to_string())
                                .unwrap_or("UNKNOWN".into()),
                            m.position
                                .as_deref()
                                .filter(|s| !s.is_empty())
                                .unwrap_or("UNKNOWN"),
                            analysis::patch(&m.version)
                        ),
                    })
                    .collect(),
            };
            items.push(stats);
        }
        let sort = |s: &ChampionStats| match q.sort.as_str() {
            "win_rate" => s.win_rate.value,
            "kda" => s.kda.value,
            "cs_per_min" => s.cs_per_min.value,
            "damage_share" => s.damage_share.value,
            _ => Some(s.games as f64),
        };
        items.sort_by(|a, b| {
            sort(b)
                .partial_cmp(&sort(a))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.champion_id.cmp(&b.champion_id))
        });
        let next_cursor = (cursor + limit < items.len()).then_some((cursor + limit) as u32);
        Ok(ChampionPool {
            items: items.into_iter().skip(cursor).take(limit).collect(),
            next_cursor,
            cached_matches: cached as u32,
            filtered_matches: filtered,
            from: starts.iter().min().cloned(),
            to: starts.iter().max().cloned(),
            truncated: cached > 10000,
        })
    }
    pub async fn compare_matches(&self, q: CompareQuery) -> Result<Comparison> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        if q.left.match_key == q.right.match_key {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let missing_left = q.left.input_revision == Some(0);
        let missing_right = q.right.input_revision == Some(0);
        if (missing_left && q.left.report_id.as_deref().is_some_and(|s| s != "none"))
            || (missing_right && q.right.report_id.as_deref().is_some_and(|s| s != "none"))
        {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let read = |s: CompareSide| ReviewQuery {
            match_key: s.match_key,
            player_key: s.player_key,
            input_revision: s.input_revision.filter(|n| *n > 0),
            report_id: s.report_id,
        };
        let left_none = q.left.report_id.as_deref() == Some("none");
        let right_none = q.right.report_id.as_deref() == Some("none");
        let mut l = q.left;
        let mut r = q.right;
        if left_none {
            l.report_id = None
        }
        if right_none {
            r.report_id = None
        }
        let mut left = self.review_data(read(l)).await?;
        let mut right = self.review_data(read(r)).await?;
        if left_none {
            left.report = None;
        }
        if missing_left {
            left.input = None;
            left.report = None;
        }
        if right_none {
            right.report = None;
        }
        if missing_right {
            right.input = None;
            right.report = None;
        }
        let (a, b) = (
            self.comparison_metrics(&left).await?,
            self.comparison_metrics(&right).await?,
        );
        let mut ids: Vec<_> = a.iter().chain(&b).map(|m| m.id.clone()).collect();
        ids.sort();
        ids.dedup();
        let metrics = ids
            .into_iter()
            .map(|id| {
                let l = a.iter().find(|m| m.id == id);
                let r = b.iter().find(|m| m.id == id);
                let compatible = l
                    .zip(r)
                    .is_some_and(|(a, b)| a.version == b.version && a.unit == b.unit);
                let v = |m: Option<&MetricResult>| {
                    m.filter(|m| m.status == MetricStatus::Available)
                        .and_then(|m| m.value)
                };
                let lv = v(l);
                let rv = v(r);
                MetricDelta {
                    id,
                    version: l.or(r).map(|m| m.version.clone()).unwrap_or_default(),
                    unit: l.or(r).map(|m| m.unit.clone()).unwrap_or_default(),
                    left: lv,
                    right: rv,
                    delta: if compatible {
                        lv.zip(rv).map(|(l, r)| r - l)
                    } else {
                        None
                    },
                    reason: if !compatible {
                        Some("incompatible_or_missing".into())
                    } else if lv.is_none() || rv.is_none() {
                        Some("missing_metric".into())
                    } else {
                        None
                    },
                }
            })
            .collect();
        let mut differences = vec![];
        if left.summary.queue_id != right.summary.queue_id {
            differences.push("queue".into())
        }
        if left.summary.champion_id != right.summary.champion_id {
            differences.push("champion".into())
        }
        if analysis::patch(&left.summary.version) != analysis::patch(&right.summary.version) {
            differences.push("patch".into())
        }
        if left.summary.player_key != right.summary.player_key {
            differences.push("player".into())
        }
        let duration = |d: &ReviewData| {
            d.input
                .as_ref()
                .map(|i| i.context.duration_ms)
                .unwrap_or_else(|| d.summary.duration.unwrap_or(0).saturating_mul(1000))
        };
        let duration_ms = duration(&left).max(duration(&right));
        Ok(Comparison {
            left,
            right,
            metrics,
            differences,
            duration_ms,
        })
    }
    pub async fn issue_summary(&self, q: IssueQuery) -> Result<IssueSummary> {
        let _workspace = self.maintenance.read().await;
        self.ready().await?;
        let f = validate_filter(q.filter)?;
        let (cursor, limit) = window(q.cursor, q.limit)?;
        let rows = self.local_reports(&f.player_key).await?;
        let truncated = rows.len() >= 10000;
        let mut groups = BTreeMap::<String, IssueGroup>::new();
        let mut count = 0;
        for (report, input) in rows {
            let m = db::summary(
                &self.pool,
                &MatchRef {
                    match_key: report.match_key.clone(),
                    player_key: f.player_key.clone(),
                },
            )
            .await?;
            if !matches_filter(&f, &m) {
                continue;
            }
            count += 1;
            let p = input
                .context
                .participants
                .iter()
                .find(|p| p.id == input.context.target_id);
            let group = format!(
                "{}:{}:{}",
                input
                    .context
                    .queue_id
                    .map(|n| n.to_string())
                    .unwrap_or("UNKNOWN".into()),
                p.and_then(|p| p.position.as_deref())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("UNKNOWN"),
                analysis::patch(&input.context.version)
            );
            for id in ["gold_deficit_10", "death_before_objective"] {
                let metric = report.metrics.iter().find(|m| m.id == id);
                let version = metric.map(|m| m.version.as_str()).unwrap_or("1");
                let g = groups
                    .entry(format!("{id}:{version}:{group}"))
                    .or_insert_with(|| IssueGroup {
                        rule_id: id.into(),
                        rule_version: version.into(),
                        group: group.clone(),
                        hits: 0,
                        eligible: 0,
                        excluded: BTreeMap::new(),
                        rate: None,
                        insufficient: true,
                        metric_id: (version == "1"
                            && p.and_then(|p| p.position.as_deref()).is_some_and(|p| {
                                ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].contains(&p)
                            }))
                        .then(|| id.into()),
                        reports: vec![],
                    });
                let value = metric
                    .filter(|m| m.status == MetricStatus::Available && m.unit == "ratio")
                    .and_then(|m| m.value);
                if let Some(value) = value {
                    g.eligible += 1;
                    if value > 0. {
                        g.hits += 1;
                        let evidence_ids = report
                            .findings
                            .iter()
                            .filter(|finding| {
                                finding.rule_id == id && finding.rule_version == version
                            })
                            .flat_map(|f| f.evidence_ids.clone())
                            .collect();
                        g.reports.push(ReportLink {
                            match_key: report.match_key.clone(),
                            player_key: f.player_key.clone(),
                            report_id: report.id.clone(),
                            input_revision: report.input_revision,
                            evidence_ids,
                        });
                    }
                } else {
                    let reason = metric
                        .and_then(|m| m.reason.as_deref())
                        .unwrap_or("rule_not_evaluated");
                    *g.excluded.entry(reason.into()).or_default() += 1;
                }
            }
        }
        let mut items: Vec<_> = groups
            .into_values()
            .map(|mut g| {
                g.rate = (g.eligible > 0).then(|| g.hits as f64 / g.eligible as f64);
                g.insufficient = g.eligible < 5;
                g
            })
            .collect();
        items.sort_by(|a, b| {
            b.hits
                .cmp(&a.hits)
                .then(a.group.cmp(&b.group))
                .then(a.rule_id.cmp(&b.rule_id))
        });
        let next_cursor = (cursor + limit < items.len()).then_some((cursor + limit) as u32);
        Ok(IssueSummary {
            items: items.into_iter().skip(cursor).take(limit).collect(),
            next_cursor,
            reports: count,
            truncated,
        })
    }
}
