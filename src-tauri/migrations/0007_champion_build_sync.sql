CREATE TABLE champion_build_rules (
  champion_id INTEGER NOT NULL,
  map_id INTEGER NOT NULL,
  entry_id TEXT NOT NULL REFERENCES notebook_entries(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  PRIMARY KEY (champion_id, map_id)
);
PRAGMA user_version=7;
