-- Up Migration
-- Roster moves (waivers, free agents, trades, commissioner) mirrored from
-- Sleeper's per-week transactions endpoint. transaction_id is globally unique so
-- it is the PK; child collections replace by league_id like the other tables.
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

-- Down Migration
DROP TABLE IF EXISTS transactions;
