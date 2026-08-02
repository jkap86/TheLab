-- Up Migration

-- How many trades a season's board holds, precomputed.
--
-- The trades page states its own size — "1,234 of 48,001 trades" — and that
-- denominator used to be a `count(*)` over the whole population on *every*
-- request. At ~50k trades in a 1.6M-row `transactions` table that is a ~56ms
-- bitmap scan per page load, paid for a number that changes only when the
-- crawler writes a new trade.
--
-- So it is stored. The unfiltered count is the common case by a wide margin —
-- the page opens unnarrowed — and it is the only one this table can answer;
-- a *filtered* count is still counted live, but only on the first page of a
-- filter set rather than on every page of one.
--
-- `updated_at` is what the refresh gates on, the same shape as
-- `projection_week_syncs`: it stamps the *attempt* that succeeded, so a season
-- with no trades stored waits out the TTL like any other rather than being
-- recounted on every tick because it looks unsynced.
CREATE TABLE IF NOT EXISTS trade_market_stats (
    season VARCHAR(8) PRIMARY KEY,
    completed_trade_count BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS trade_market_stats;
