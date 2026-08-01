-- Up Migration

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
