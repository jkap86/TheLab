-- Up Migration
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
