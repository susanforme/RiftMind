CREATE TABLE personal_baselines(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reviews(id), all_champions INTEGER NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX baseline_by_report ON personal_baselines(report_id,all_champions,created_at);
CREATE TABLE preparation_batches(id TEXT PRIMARY KEY, player_key TEXT NOT NULL REFERENCES players(player_key), state TEXT NOT NULL, payload TEXT NOT NULL);
ALTER TABLE jobs ADD COLUMN preparation_id TEXT;
PRAGMA user_version=5;
