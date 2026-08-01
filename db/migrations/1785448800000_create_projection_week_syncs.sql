-- Up Migration

-- When each projections week was last fetched from Sleeper, whether or not the
-- fetch produced rows (see src/shared/projections/sync.ts).
--
-- The `projections` table can't carry this fact: a week Sleeper hasn't
-- published yet stores no rows, so judging freshness by rows alone marks it due
-- again on every tick — refetched every 15 minutes all through the window
-- before publication, and (because the horizon budget takes the earliest stale
-- weeks first) able to crowd published weeks out of the per-tick cap
-- indefinitely. A successful fetch stamps this table either way, so an empty
-- week waits out the same TTL as a full one. A failed fetch stamps nothing and
-- is retried next tick, which is the behavior worth keeping.
CREATE TABLE IF NOT EXISTS projection_week_syncs (
    season VARCHAR(8) NOT NULL,
    week SMALLINT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (season, week)
);

-- Down Migration
DROP TABLE IF EXISTS projection_week_syncs;
