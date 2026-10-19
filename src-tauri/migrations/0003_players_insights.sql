CREATE TABLE favorites (
 player_key TEXT PRIMARY KEY REFERENCES players(player_key),
 created_at TEXT NOT NULL
);
CREATE TABLE player_profiles (
 player_key TEXT NOT NULL REFERENCES players(player_key),
 scope TEXT NOT NULL,
 collected_at TEXT NOT NULL,
 payload TEXT NOT NULL,
 PRIMARY KEY(player_key,scope)
);
CREATE INDEX stage3_matches_started ON matches(started_at DESC,match_key DESC);
PRAGMA user_version=3;
