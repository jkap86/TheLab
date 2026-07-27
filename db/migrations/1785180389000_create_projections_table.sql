-- Up Migration

-- Weekly player projections from Sleeper (see src/shared/projections).
--
-- One row per player per week of a season. The upstream response covers every
-- player on the slate in a single request, but ~90% of its entries are
-- placeholders with no game and no stats; only entries tied to a scheduled game
-- land here (see `hasProjection` in shared/projections/parse.ts), so a week is
-- roughly 800 rows rather than 9,000.
--
-- `company` is the projection provider Sleeper is republishing ("rotowire" for
-- every entry observed so far). The primary key deliberately leaves it out: one
-- provider per player per week is the observed shape, and a second one appearing
-- should overwrite rather than double the row count. If Sleeper ever serves two
-- at once, this is the assumption to revisit.
--
-- The three `pts_*` columns are promoted because ordering and comparing on them
-- is the whole point of the table. They are Sleeper's own scoring of the stat
-- line for the three common formats — a league with custom scoring has to be
-- scored from `stats`, which keeps the full projected stat line (~45 keys,
-- including IDP and kicker detail).
--
-- No FK to `players`: that cache refreshes daily, so a projection can name a
-- player it doesn't have yet, and losing the projection over it would be the
-- wrong trade.
CREATE TABLE IF NOT EXISTS projections (
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
    -- Sleeper's own `last_modified` for the projection, which moves when they
    -- revise it. Distinct from `updated_at`, which is when we last wrote the
    -- row and is what the sync's freshness gate reads.
    source_updated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (season, week, player_id)
);

-- "Best projected players in week N", the read the lineup tools are built on.
CREATE INDEX IF NOT EXISTS projections_week_pts_idx
    ON projections (season, week, pts_ppr DESC NULLS LAST);

-- One player's season, newest week first.
CREATE INDEX IF NOT EXISTS projections_player_idx
    ON projections (player_id, season, week DESC);

-- Down Migration
DROP TABLE IF EXISTS projections;
