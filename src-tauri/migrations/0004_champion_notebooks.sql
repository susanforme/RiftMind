CREATE TABLE notebook_entries(id TEXT PRIMARY KEY, champion_id INTEGER NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL);
CREATE INDEX notebook_by_champion ON notebook_entries(champion_id, deleted);
CREATE TABLE notebook_revisions(entry_id TEXT NOT NULL REFERENCES notebook_entries(id) ON DELETE CASCADE, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(entry_id,revision));
CREATE TABLE practice_entries(id TEXT PRIMARY KEY, champion_id INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE build_applications(entry_id TEXT NOT NULL, player_key TEXT NOT NULL, remote_uid TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(entry_id,player_key));
PRAGMA user_version=4;
