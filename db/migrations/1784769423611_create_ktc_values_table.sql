-- Up Migration

-- Cache of KeepTradeCut dynasty trade values, scraped from the public
-- dynasty-rankings page (~500 rows: players plus rookie draft picks, position
-- "RDP"). Keyed by KTC's own stable playerID. Structured columns cover the
-- common lookups (superflex / 1QB value + rank); the full scraped entry is kept
-- verbatim in `data`. Refreshed in-process every 15 minutes (src/shared/ktc).
--
-- `sleeper_id` links a value row to a `players.player_id`. KTC exposes no
-- Sleeper id (only `mflid`, which Sleeper's map does not carry), so it is
-- resolved by name+position matching at sync time and is null for draft picks
-- and the handful of players that don't match (see src/shared/ktc/match.ts).
CREATE TABLE IF NOT EXISTS ktc_values (
    ktc_id INTEGER PRIMARY KEY,
    sleeper_id VARCHAR(64),
    player_name VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    position VARCHAR(16),
    team VARCHAR(16),
    rookie BOOLEAN NOT NULL DEFAULT false,
    age NUMERIC(5, 2),
    sf_value INTEGER,
    sf_rank INTEGER,
    sf_position_rank INTEGER,
    oneqb_value INTEGER,
    oneqb_rank INTEGER,
    oneqb_position_rank INTEGER,
    data JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ktc_values_position_idx ON ktc_values (position);
CREATE INDEX IF NOT EXISTS ktc_values_sf_value_idx ON ktc_values (sf_value DESC);
CREATE INDEX IF NOT EXISTS ktc_values_sleeper_id_idx ON ktc_values (sleeper_id);

-- Down Migration
DROP TABLE IF EXISTS ktc_values;
