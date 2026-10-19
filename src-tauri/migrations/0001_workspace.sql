CREATE TABLE IF NOT EXISTS players (
 player_key TEXT PRIMARY KEY, server_id TEXT NOT NULL, puuid TEXT NOT NULL,
 display_name TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
 match_key TEXT PRIMARY KEY, server_id TEXT NOT NULL, game_id TEXT NOT NULL,
 started_at TEXT NOT NULL, queue_id INTEGER, version TEXT NOT NULL,
 UNIQUE(server_id,game_id)
);
CREATE TABLE IF NOT EXISTS match_participants (
 match_key TEXT NOT NULL REFERENCES matches(match_key) ON DELETE CASCADE,
 player_key TEXT NOT NULL REFERENCES players(player_key), champion_id INTEGER,
 outcome TEXT NOT NULL, kills INTEGER, deaths INTEGER, assists INTEGER,
 duration INTEGER, position TEXT, cs INTEGER, items TEXT NOT NULL,
 source TEXT NOT NULL, fallback_reason TEXT, revision INTEGER NOT NULL, projection TEXT NOT NULL,
 PRIMARY KEY(match_key,player_key)
);
CREATE INDEX IF NOT EXISTS matches_order ON matches(started_at DESC, match_key DESC);
CREATE INDEX IF NOT EXISTS participants_player ON match_participants(player_key,match_key);
CREATE TABLE IF NOT EXISTS source_snapshots (
 hash TEXT PRIMARY KEY, source TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS match_revisions (
 match_key TEXT NOT NULL REFERENCES matches(match_key), player_key TEXT NOT NULL,
 revision INTEGER NOT NULL, hash TEXT NOT NULL REFERENCES source_snapshots(hash),
 PRIMARY KEY(match_key,player_key,revision)
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, player_key TEXT, state TEXT NOT NULL, checkpoint INTEGER NOT NULL DEFAULT 0,
 budget INTEGER NOT NULL, session_epoch TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT,
 cancel_requested INTEGER NOT NULL DEFAULT 0,
 kind TEXT NOT NULL DEFAULT 'sync', result TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active ON jobs(player_key) WHERE state IN ('queued','running');
CREATE TABLE IF NOT EXISTS sync_state (
 player_key TEXT PRIMARY KEY REFERENCES players(player_key), last_sync TEXT NOT NULL,
 pages INTEGER NOT NULL, matches_count INTEGER NOT NULL, exhausted INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS resource_manifests (
 resource_key TEXT PRIMARY KEY, version TEXT NOT NULL, locale TEXT NOT NULL,
 resource_id TEXT NOT NULL, path TEXT, hash TEXT, name TEXT, availability TEXT NOT NULL
);
PRAGMA user_version = 1;
