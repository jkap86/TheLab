-- Up Migration

-- Freshness gate: records when a manager's leagues were last synced for a
-- season, so the leagues route can skip the expensive Sleeper re-fetch when the
-- data is still fresh. Rows exist even for managers with zero leagues.
CREATE TABLE IF NOT EXISTS manager_syncs (
    user_id VARCHAR(255) NOT NULL,
    season VARCHAR(8) NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, season)
);

-- Cache of Sleeper's global NFL players map (/v1/players/nfl, ~12k entries,
-- ~5MB). Refreshed at most once a day. `full_name` is null for team defenses
-- (keyed by team abbreviation); the full payload is kept in `data`.
CREATE TABLE IF NOT EXISTS players (
    player_id VARCHAR(64) PRIMARY KEY,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    full_name VARCHAR(255),
    position VARCHAR(16),
    team VARCHAR(16),
    fantasy_positions JSONB,
    status VARCHAR(32),
    sport VARCHAR(16),
    data JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS players_position_idx ON players (position);
CREATE INDEX IF NOT EXISTS players_team_idx ON players (team);

-- Down Migration
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS manager_syncs;
