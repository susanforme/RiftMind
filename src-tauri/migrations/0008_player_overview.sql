DELETE FROM player_profiles;
CREATE TABLE local_accounts (
 player_key TEXT PRIMARY KEY REFERENCES players(player_key),
 last_connected_at TEXT NOT NULL
);
CREATE TABLE rank_snapshots (
 player_key TEXT NOT NULL REFERENCES local_accounts(player_key),
 queue TEXT NOT NULL,
 collected_at TEXT NOT NULL,
 payload TEXT NOT NULL,
 PRIMARY KEY(player_key,queue,collected_at)
);
PRAGMA user_version=8;
