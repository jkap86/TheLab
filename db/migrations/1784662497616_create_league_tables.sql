-- Up Migration
-- Tables mirroring the Sleeper league graph for a manager:
--   leagues -> {league_users, rosters, traded_picks, drafts -> draft_picks}
-- Flexible/nested Sleeper payloads (settings, scoring, metadata, id arrays) are
-- kept as JSONB; the columns we query/join on are promoted to real columns.

CREATE TABLE IF NOT EXISTS leagues (
    league_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255),
    season VARCHAR(8) NOT NULL,
    sport VARCHAR(16) NOT NULL DEFAULT 'nfl',
    status VARCHAR(32),
    total_rosters INTEGER,
    avatar VARCHAR(255),
    previous_league_id VARCHAR(255),
    draft_id VARCHAR(255),
    roster_positions JSONB,
    settings JSONB,
    scoring_settings JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leagues_season_idx ON leagues (season);

-- League membership + team info. user_id is NOT FK'd to users: league members
-- other than the searched manager may never be fetched as standalone users.
CREATE TABLE IF NOT EXISTS league_users (
    league_id VARCHAR(255) NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    avatar VARCHAR(255),
    team_name VARCHAR(255),
    is_owner BOOLEAN,
    is_bot BOOLEAN,
    metadata JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (league_id, user_id)
);
CREATE INDEX IF NOT EXISTS league_users_user_idx ON league_users (user_id);

-- One row per team. owner_id can be null (orphan/commissioner-held teams).
CREATE TABLE IF NOT EXISTS rosters (
    league_id VARCHAR(255) NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    roster_id INTEGER NOT NULL,
    owner_id VARCHAR(255),
    players JSONB,
    starters JSONB,
    reserve JSONB,
    taxi JSONB,
    settings JSONB,
    metadata JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (league_id, roster_id)
);
CREATE INDEX IF NOT EXISTS rosters_owner_idx ON rosters (owner_id);

-- Future draft pick ASSETS. Identity is the original pick (season, round,
-- roster_id); owner_id/previous_owner_id are ROSTER ids (ints), not user ids.
CREATE TABLE IF NOT EXISTS traded_picks (
    league_id VARCHAR(255) NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    season VARCHAR(8) NOT NULL,
    round INTEGER NOT NULL,
    roster_id INTEGER NOT NULL,
    owner_id INTEGER NOT NULL,
    previous_owner_id INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (league_id, season, round, roster_id)
);
CREATE INDEX IF NOT EXISTS traded_picks_owner_idx ON traded_picks (league_id, owner_id);

CREATE TABLE IF NOT EXISTS drafts (
    draft_id VARCHAR(255) PRIMARY KEY,
    league_id VARCHAR(255) NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    season VARCHAR(8),
    status VARCHAR(32),
    type VARCHAR(32),
    start_time BIGINT,
    draft_order JSONB,
    settings JSONB,
    metadata JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_league_idx ON drafts (league_id);

-- Actual drafted players. picked_by can be an empty string (autopick/no user).
CREATE TABLE IF NOT EXISTS draft_picks (
    draft_id VARCHAR(255) NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    pick_no INTEGER NOT NULL,
    round INTEGER,
    roster_id INTEGER,
    player_id VARCHAR(255),
    picked_by VARCHAR(255),
    metadata JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (draft_id, pick_no)
);
CREATE INDEX IF NOT EXISTS draft_picks_player_idx ON draft_picks (player_id);

-- Down Migration
DROP TABLE IF EXISTS draft_picks;
DROP TABLE IF EXISTS drafts;
DROP TABLE IF EXISTS traded_picks;
DROP TABLE IF EXISTS rosters;
DROP TABLE IF EXISTS league_users;
DROP TABLE IF EXISTS leagues;
