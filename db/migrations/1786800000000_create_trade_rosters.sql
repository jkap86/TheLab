-- Up Migration

-- What each side of a trade held immediately *before* it.
--
-- A trade card says what moved and nothing about the roster it moved off, which
-- is most of what makes a deal legible: three receivers for a first reads one
-- way off a team that had eight and another off a team that had three. Sleeper
-- publishes no history — `rosters` is only ever *now* — so the state is
-- reconstructed by walking the league's later transactions backwards from the
-- current roster (`shared/trades/rewind.ts`) and stored here, because the walk
-- is a fact about the whole league's transaction log and re-deriving it per
-- request would mean reading that log per trade on the board.
--
-- **Keyed by the trade and the roster, not by the league and a timestamp.** Two
-- trades a minute apart are two different answers and the board addresses them
-- by `transaction_id`; a time-keyed table would have to be range-searched to
-- name the row a card wants.
--
-- Only the *participating* rosters are stored. What the other ten teams held is
-- a different question (how the league as a whole looked), and storing it would
-- multiply this table by the league size for something no card asks.
CREATE TABLE IF NOT EXISTS trade_rosters (
    transaction_id VARCHAR(255) NOT NULL,
    roster_id INTEGER NOT NULL,
    -- **The league is the only foreign key here, and the absence of one on
    -- `transaction_id` is deliberate.** `writeLeagueGraph` refreshes
    -- transactions by deleting a week range and re-inserting it, so a cascade
    -- from that table would throw these rows away on every sync of every
    -- league's current weeks — the newest trades on the board, dropped and
    -- recomputed every fifteen minutes. Cascading from `leagues` is right for
    -- the same reason it is right everywhere else in the graph: a league that
    -- goes takes its trades with it.
    league_id VARCHAR(255) NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    -- Player ids as a JSONB array, the spelling `rosters.players` already uses.
    players JSONB NOT NULL,
    -- `{season, round, roster_id}` per owned future pick, where `roster_id` is
    -- the pick's *original* owner — Sleeper's own naming, and the same shape
    -- `TradePickAsset` carries, so a stored pick and a traded one read alike.
    draft_picks JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (transaction_id, roster_id)
);

-- The sync asks "which of this league's trades already have a snapshot" once
-- per league per pass, which is the only access path that isn't the primary key.
CREATE INDEX IF NOT EXISTS trade_rosters_league_idx ON trade_rosters (league_id);

-- Down Migration
DROP TABLE IF EXISTS trade_rosters;
