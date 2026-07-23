-- Up Migration

-- Daily history of KeepTradeCut dynasty values, one row per player per day.
--
-- Two writers fill this table (src/shared/ktc/history.ts):
--   * the 15-minute values sync records today's snapshot for every player on
--     the rankings page — no extra requests, keeps history current going
--     forward;
--   * a slow backfill scrapes individual player pages, which embed the full
--     value/rank series (~2000 days for long-tenured players), a few players
--     per tick so the corpus fills in over a day or so.
-- Both upsert on (ktc_id, date), so the authoritative per-player series
-- overwrites any snapshot row for the same day.
--
-- Values mirror `ktc_values`: the base (non tight-end-premium) superflex and
-- 1QB series. Draft picks (position "RDP") have no positional rank history, so
-- those columns are null for them.
CREATE TABLE IF NOT EXISTS ktc_value_history (
    ktc_id INTEGER NOT NULL REFERENCES ktc_values (ktc_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    sf_value INTEGER,
    sf_rank INTEGER,
    sf_position_rank INTEGER,
    oneqb_value INTEGER,
    oneqb_rank INTEGER,
    oneqb_position_rank INTEGER,
    PRIMARY KEY (ktc_id, date)
);

-- Supports "everyone's value on date X" / recent-window scans; the primary key
-- already covers the far more common "one player's series" lookup.
CREATE INDEX IF NOT EXISTS ktc_value_history_date_idx ON ktc_value_history (date DESC);

-- Backfill bookkeeping on the parent row. `history_attempt_at` is stamped on
-- every attempt and `history_synced_at` only on success, so the queue is
-- ordered by attempt (a player whose page keeps failing can't block the head of
-- the line) while freshness is judged on actual successes.
ALTER TABLE ktc_values
    ADD COLUMN IF NOT EXISTS history_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS history_attempt_at TIMESTAMPTZ;

-- Down Migration
ALTER TABLE ktc_values
    DROP COLUMN IF EXISTS history_attempt_at,
    DROP COLUMN IF EXISTS history_synced_at;
DROP TABLE IF EXISTS ktc_value_history;
