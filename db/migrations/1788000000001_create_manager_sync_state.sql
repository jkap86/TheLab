-- Up Migration
-- Per-manager bookkeeping for the leagues sync: how fresh a manager's graph is,
-- and the order Sleeper lists their leagues in.

-- Freshness gate: records when a manager's leagues were last synced for a
-- season, so the leagues route can skip the expensive Sleeper re-fetch when the
-- data is still fresh. Rows exist even for managers with zero leagues — that is
-- an answer, and re-deriving it every request is the cost this avoids.
CREATE TABLE IF NOT EXISTS manager_syncs (
    user_id VARCHAR(255) NOT NULL,
    season VARCHAR(8) NOT NULL,
    -- **Nullable, and with no default, on purpose.** It means "this manager's
    -- full league graph was synced COMPLETELY", and only a complete sync
    -- advances it. A default of now() would be a claim the row cannot support:
    -- a manager whose graph half-failed would read as current, and the leagues
    -- route reads `stale` straight off it.
    synced_at TIMESTAMPTZ,
    -- When anybody last TRIED, whatever the outcome. This is what carries the
    -- retry throttle: without it, a manager whose sync keeps failing would
    -- re-ask Sleeper for the whole graph on every single request, because
    -- `synced_at` (correctly) never advances.
    attempt_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, season)
);
CREATE INDEX IF NOT EXISTS manager_syncs_attempt_idx
    ON manager_syncs (season, attempt_at ASC NULLS FIRST);

-- The order Sleeper lists a manager's leagues in, which is the order they see
-- everywhere in Sleeper itself and so the order this app lists them in.
--
-- It is a fact about a *manager's* enumeration (`/user/:id/leagues/nfl/:season`)
-- and not about a league, so it can't hang off `leagues` or `league_users`:
-- those are replaced wholesale per league by any sync — including the crawler's,
-- which reaches a league without knowing whose list it came from — and the
-- position would be wiped by the next unrelated refresh. Its own table, written
-- by the manager sync that did the enumerating.
CREATE TABLE IF NOT EXISTS manager_league_order (
    user_id VARCHAR(255) NOT NULL,
    season VARCHAR(8) NOT NULL,
    league_id VARCHAR(255) NOT NULL,
    -- Zero-based index in Sleeper's response. Not unique: a stale row for a
    -- league the manager has left is harmless (nothing joins to it), and a
    -- uniqueness constraint would only turn that into a failed sync.
    position INTEGER NOT NULL,
    PRIMARY KEY (user_id, season, league_id)
);

-- Down Migration
DROP TABLE IF EXISTS manager_league_order;
DROP TABLE IF EXISTS manager_syncs;
