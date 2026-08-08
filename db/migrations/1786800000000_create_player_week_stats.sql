-- Up Migration

-- Actual weekly stat lines from Sleeper (see src/shared/stats).
--
-- The sibling of `projections`, deliberately built to the same shape: Sleeper
-- serves both off the same undocumented host with the same envelope
-- (`SleeperProjection` in shared/sleeper/types, whose own note already said the
-- stats endpoint reuses it), so a second table shaped differently would mean two
-- parsers, two validators and two freshness gates for one response format.
--
-- What it is *for* is the other half of the projection. A projection says what a
-- player is expected to do; this says what he did — and the two answer different
-- questions on a lineup screen, which is why the lineup checker's league panel
-- reads a week's projection beside the season's points per game. Sleeper
-- publishes no per-game average anywhere, so a PPG is this table summed.
--
-- **It is scored per league, never read off `pts_ppr`.** The promoted `pts_*`
-- columns are Sleeper's own scoring of the stat line for three common formats,
-- and a league's own scoring is what a roster panel has to show — `pts_ppr`
-- alone is 0.05 a passing yard against Sleeper's own league default of 0.04.
-- They are promoted anyway for the same reason they are on `projections`:
-- ordering and comparing on them is cheap and a league-less board wants one.
-- `stats` keeps the full line, which is what `projections/score` dots against
-- `scoring_settings`.
--
-- No FK to `players`, the `projections` rule: that cache refreshes daily, so a
-- stat line can name a player it doesn't have yet, and losing the line over it
-- would be the wrong trade.
CREATE TABLE IF NOT EXISTS player_week_stats (
    season VARCHAR(8) NOT NULL,
    week SMALLINT NOT NULL,
    player_id VARCHAR(64) NOT NULL,
    company VARCHAR(32),
    team VARCHAR(16),
    opponent VARCHAR(16),
    game_id VARCHAR(32),
    game_date DATE,
    pts_std NUMERIC(6, 2),
    pts_half_ppr NUMERIC(6, 2),
    pts_ppr NUMERIC(6, 2),
    stats JSONB,
    -- Sleeper's own `last_modified`, which moves when a stat line is corrected
    -- (and they are corrected — a stat correction on Wednesday is routine).
    -- Distinct from `updated_at`, which is when we last wrote the row.
    source_updated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (season, week, player_id)
);

-- "This player's completed weeks, this season" — the read a points-per-game
-- average is summed from, and the only read this table has on a hot path.
CREATE INDEX IF NOT EXISTS player_week_stats_player_idx
    ON player_week_stats (player_id, season, week DESC);

-- One week whole, for the sync's own replace-and-delete and for a league-less
-- board over a single week.
CREATE INDEX IF NOT EXISTS player_week_stats_week_idx
    ON player_week_stats (season, week);

-- Freshness by `(season, week)`, stamped on a *successful* fetch whether or not
-- it returned anything — the `projection_week_syncs` rule, and it bites harder
-- here. A week that has not been played yet legitimately has no stat lines at
-- all, so a gate reading the rows themselves would find every future week
-- unsynced and refetch the whole horizon every tick, forever. A failed fetch
-- stamps nothing and retries next tick.
CREATE TABLE IF NOT EXISTS stat_week_syncs (
    season VARCHAR(8) NOT NULL,
    week SMALLINT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (season, week)
);

-- Down Migration
DROP TABLE IF EXISTS stat_week_syncs;
DROP TABLE IF EXISTS player_week_stats;
