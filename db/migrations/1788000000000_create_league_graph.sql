-- Up Migration
-- Tables mirroring the Sleeper league graph for a manager:
--   leagues -> {league_users, rosters, traded_picks, drafts -> draft_picks,
--               transactions, matchups}
-- Flexible/nested Sleeper payloads (settings, scoring, metadata, id arrays) are
-- kept as JSONB; the columns we query/join on are promoted to real columns.
--
-- Consolidated from TheLabX, where this graph arrived over eight migrations
-- against a live database. There is nothing to migrate here, so the columns
-- those added are folded into the CREATEs — including the ones only the
-- deferred background crawler reads (`sync_attempt_at`, `gone_at`,
-- `last_accessed_at`), which are cheap to carry now and would otherwise make
-- that port a schema change.

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
    -- When this league's graph was last written WHOLE. persistLeagueGraph is
    -- the only writer, and it advances this only on a complete fetch, which is
    -- what makes it the freshness signal. A row that has never had a graph
    -- written carries 'epoch' rather than now(): a default is a claim.
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- When anybody last TRIED, success or not. Orders the crawler's refresh
    -- queue (not `updated_at`) so a league whose fetch keeps failing rotates to
    -- the back instead of being retried every tick ahead of everyone else.
    sync_attempt_at TIMESTAMPTZ,
    -- When Sleeper stopped serving a stored league (200 with a null body — a
    -- deleted league). Null for a league Sleeper still answers for. Without it
    -- a deleted league is due forever. A sync that finds the league alive again
    -- clears the marker (see persistLeagueGraph's upsert).
    gone_at TIMESTAMPTZ,
    -- When somebody last actually looked at this league. Stamped where demand
    -- is *observed* — a manager's league sync — and deliberately not by the
    -- crawler, which would make every league look demanded within one rotation.
    -- Null is the ordinary state and reads as the coldest tier, not a missing
    -- value.
    last_accessed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS leagues_season_idx ON leagues (season);
CREATE INDEX IF NOT EXISTS leagues_sync_attempt_idx
    ON leagues (season, sync_attempt_at ASC NULLS FIRST);
-- Finding a season's due leagues, which is the crawler claim query's input.
CREATE INDEX IF NOT EXISTS leagues_season_due_idx
    ON leagues (season, updated_at)
 WHERE gone_at IS NULL;

-- League membership + team info. user_id is NOT FK'd to a users table: league
-- members other than the searched manager may never be fetched as standalone
-- users, and this is where a user's identity in a league actually lives.
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
-- Both columns of `FIELDED_A_TEAM_SQL`'s EXISTS, which every "this manager's
-- leagues" read opens with; the INCLUDE keeps it index-only.
CREATE INDEX IF NOT EXISTS rosters_owner_league_idx
    ON rosters (owner_id, league_id) INCLUDE (roster_id);

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
    -- When the draft's most recent pick was made, epoch milliseconds, straight
    -- from Sleeper. Null where Sleeper sent none — a draft nobody has picked in
    -- yet.
    last_picked BIGINT,
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

-- Roster moves (waivers, free agents, trades, commissioner) mirrored from
-- Sleeper's per-week transactions endpoint. transaction_id is globally unique so
-- it is the PK; persistence replaces only the weeks a sync re-fetched.
-- adds/drops map player_id -> roster_id; roster_ids/consenter_ids are roster ids.
-- created/status_updated are epoch milliseconds.
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id VARCHAR(255) PRIMARY KEY,
    league_id VARCHAR(255) NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    type VARCHAR(32),
    status VARCHAR(32),
    week INTEGER,
    creator VARCHAR(255),
    created BIGINT,
    status_updated BIGINT,
    roster_ids JSONB,
    consenter_ids JSONB,
    adds JSONB,
    drops JSONB,
    draft_picks JSONB,
    waiver_budget JSONB,
    settings JSONB,
    metadata JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_league_idx ON transactions (league_id);
CREATE INDEX IF NOT EXISTS transactions_league_week_idx ON transactions (league_id, week);

-- Weekly scoring, mirrored from Sleeper's per-week matchups endpoint. Like
-- transactions, matchups are keyed by week and have no all-at-once endpoint, so
-- a league's season is the union of each week and persistence replaces only the
-- weeks a sync re-fetched.
--
-- One row per (league, week, roster): Sleeper returns a *side*, not a game. The
-- two sides of a game share a `matchup_id`, which is null for a roster with no
-- opponent that week — a bye in an odd-sized league, or a week the league has
-- not scheduled.
--
-- `points` is DOUBLE PRECISION rather than NUMERIC so it arrives from pg as a
-- number; the per-player and per-slot breakdowns stay JSONB until something
-- queries them. `starters_points` is positional against `starters`.
CREATE TABLE IF NOT EXISTS matchups (
    league_id VARCHAR(255) NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    week INTEGER NOT NULL,
    roster_id INTEGER NOT NULL,
    matchup_id INTEGER,
    points DOUBLE PRECISION,
    custom_points DOUBLE PRECISION,
    starters JSONB,
    players JSONB,
    starters_points JSONB,
    players_points JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (league_id, week, roster_id)
);
-- The primary key already serves league_id and (league_id, week) lookups; this
-- is the pairing index — both sides of one game, which is how a matchup is read.
CREATE INDEX IF NOT EXISTS matchups_league_week_matchup_idx
    ON matchups (league_id, week, matchup_id);

-- Down Migration
DROP TABLE IF EXISTS matchups;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS draft_picks;
DROP TABLE IF EXISTS drafts;
DROP TABLE IF EXISTS traded_picks;
DROP TABLE IF EXISTS rosters;
DROP TABLE IF EXISTS league_users;
DROP TABLE IF EXISTS leagues;
