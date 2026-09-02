-- Up Migration
-- KeepTradeCut trade values, scraped from the public rankings pages and synced
-- by `src/shared/ktc` — current values on a 15-minute loop, each player's full
-- daily series backfilled once at boot.

-- One row per KTC entry per format. **`format` is in the key because KTC's
-- `playerID` is per-board, not global**: of 280 names on both boards when this
-- was built, 183 carried different ids (Bijan Robinson is dynasty 1414 and
-- redraft 1507), and the same number can name different people on the two
-- boards — so `ktc_id` alone would silently mix them. The superflex axis is
-- *columns* rather than rows for the complementary reason: one scraped page
-- carries both `superflexValues` and `oneQBValues` per entry, so a row is
-- "what one fetch said about one entry" and the two boards are two readings of
-- it. Entries are players plus, on the dynasty board only, rookie draft picks
-- (position 'RDP'); redraft adds 'PK' and 'DST' instead.
--
-- `sleeper_id` is always null for now: KTC exposes no Sleeper id, and the
-- name-matching that resolves one (TheLabX's `ktc/match.ts`) needs the synced
-- players table that arrives with it. The column ships so that port is a
-- backfill rather than a migration. It must never become unique — two KTC rows
-- can legitimately resolve to one Sleeper player, and the boards have to be
-- folded independently at read time.
CREATE TABLE IF NOT EXISTS ktc_values (
    format VARCHAR(8) NOT NULL,
    ktc_id INTEGER NOT NULL,
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
    -- The full scraped entry, verbatim. KTC ships far more than is columned
    -- (adp, liquidity, TE-premium variants) and re-scraping the past is not an
    -- option, so what the page said is kept whole.
    data JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Backfill bookkeeping, the `manager_syncs` two-column rule at this grain:
    -- `history_attempt_at` is stamped on every attempt and orders the queue (a
    -- player whose page keeps failing rotates to the back instead of blocking
    -- the head), `history_synced_at` only on success and is what says the
    -- series is actually stored. One column cannot do both jobs.
    history_synced_at TIMESTAMPTZ,
    history_attempt_at TIMESTAMPTZ,
    PRIMARY KEY (format, ktc_id)
);
CREATE INDEX IF NOT EXISTS ktc_values_position_idx
    ON ktc_values (format, position);
CREATE INDEX IF NOT EXISTS ktc_values_sf_value_idx
    ON ktc_values (format, sf_value DESC);
CREATE INDEX IF NOT EXISTS ktc_values_sleeper_id_idx
    ON ktc_values (sleeper_id);
CREATE INDEX IF NOT EXISTS ktc_values_history_queue_idx
    ON ktc_values (history_attempt_at ASC NULLS FIRST);

-- Daily history, one row per entry per format per day. Two writers, one
-- conflict target: the 15-minute sync snapshots today's row for everything on
-- the board (no extra requests), and the boot backfill scrapes each player's
-- page, whose embedded series is authoritative over any snapshot for the same
-- day. Dates are KTC's own — their series roll over on US-Eastern days, so the
-- snapshot writer stamps `America/New_York` rather than UTC.
CREATE TABLE IF NOT EXISTS ktc_value_history (
    format VARCHAR(8) NOT NULL,
    ktc_id INTEGER NOT NULL,
    date DATE NOT NULL,
    sf_value INTEGER,
    sf_rank INTEGER,
    sf_position_rank INTEGER,
    oneqb_value INTEGER,
    oneqb_rank INTEGER,
    oneqb_position_rank INTEGER,
    PRIMARY KEY (format, ktc_id, date),
    FOREIGN KEY (format, ktc_id)
        REFERENCES ktc_values (format, ktc_id) ON DELETE CASCADE
);

-- Supports "everyone's value on date X" / recent-window scans; the primary key
-- already covers the far more common "one player's series" lookup.
CREATE INDEX IF NOT EXISTS ktc_value_history_date_idx
    ON ktc_value_history (format, date DESC);

-- Down Migration
DROP TABLE IF EXISTS ktc_value_history;
DROP TABLE IF EXISTS ktc_values;
