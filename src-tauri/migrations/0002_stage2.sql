DROP INDEX IF EXISTS jobs_active;
ALTER TABLE jobs ADD COLUMN dedupe_key TEXT;
ALTER TABLE jobs ADD COLUMN request TEXT;
ALTER TABLE jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE jobs ADD COLUMN retry_at TEXT;
UPDATE jobs SET dedupe_key=player_key WHERE kind='sync';
CREATE UNIQUE INDEX jobs_active ON jobs(kind,dedupe_key) WHERE state IN ('queued','running') AND dedupe_key IS NOT NULL;
CREATE TABLE snapshot_refs (
 id TEXT PRIMARY KEY, match_key TEXT NOT NULL REFERENCES matches(match_key), endpoint TEXT NOT NULL,
 source TEXT NOT NULL, fetched_at TEXT NOT NULL, hash TEXT NOT NULL REFERENCES source_snapshots(hash)
);
CREATE INDEX snapshot_object ON snapshot_refs(match_key,endpoint,fetched_at);
CREATE TABLE analysis_inputs (
 id TEXT PRIMARY KEY, match_key TEXT NOT NULL REFERENCES matches(match_key), player_key TEXT NOT NULL REFERENCES players(player_key),
 revision INTEGER NOT NULL, fingerprint TEXT NOT NULL, summary_ref TEXT NOT NULL REFERENCES snapshot_refs(id),
 timeline_ref TEXT REFERENCES snapshot_refs(id), payload TEXT NOT NULL,
 UNIQUE(match_key,player_key,revision), UNIQUE(match_key,player_key,fingerprint)
);
CREATE TABLE detail_attempts (
 match_key TEXT NOT NULL REFERENCES matches(match_key), player_key TEXT NOT NULL REFERENCES players(player_key),
 summary_status TEXT NOT NULL, timeline_status TEXT NOT NULL, error TEXT, retry_at TEXT,
 PRIMARY KEY(match_key,player_key)
);
CREATE TABLE reviews (
 id TEXT PRIMARY KEY, match_key TEXT NOT NULL REFERENCES matches(match_key), player_key TEXT NOT NULL REFERENCES players(player_key),
 input_id TEXT NOT NULL REFERENCES analysis_inputs(id), revision INTEGER NOT NULL, rule_version TEXT NOT NULL,
 payload TEXT NOT NULL, UNIQUE(input_id,rule_version), UNIQUE(match_key,player_key,revision)
);
CREATE INDEX reviews_player ON reviews(player_key,match_key,revision DESC);
CREATE TABLE review_notes (
 id TEXT PRIMARY KEY, match_key TEXT NOT NULL REFERENCES matches(match_key), player_key TEXT NOT NULL REFERENCES players(player_key),
 report_id TEXT REFERENCES reviews(id), evidence_id TEXT, text TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX notes_match ON review_notes(match_key,player_key);
CREATE TABLE review_feedback (
 report_id TEXT NOT NULL REFERENCES reviews(id), finding_id TEXT NOT NULL, value TEXT,
 revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(report_id,finding_id)
);
CREATE TABLE training_goals (
 id TEXT PRIMARY KEY, player_key TEXT NOT NULL REFERENCES players(player_key), state TEXT NOT NULL,
 revision INTEGER NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX goals_player ON training_goals(player_key,state);
CREATE TABLE goal_evaluations (
 id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES training_goals(id), revision INTEGER NOT NULL,
 fingerprint TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(goal_id,revision), UNIQUE(goal_id,fingerprint)
);
PRAGMA user_version = 2;
