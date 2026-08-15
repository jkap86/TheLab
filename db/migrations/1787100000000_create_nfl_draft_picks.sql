-- Where a player was taken in the *NFL* draft, keyed by Sleeper player id.
--
-- Sleeper's players map carries no draft position at all — `years_exp` is the
-- only career marker it publishes, and it counts completed seasons as of now
-- (the deferral `players/queries.ts` describes for `rookie_season`). So this is
-- a second non-Sleeper source alongside KeepTradeCut, and it gets its own table
-- for the reason KTC does: a module owns its tables, and `players` is rewritten
-- wholesale from Sleeper's map every day.
--
-- **The name is `nfl_draft_picks` and not `draft_picks` because that table
-- already exists and means something else entirely** — the picks made in a
-- crawled *fantasy* draft, which is what feeds the ADP board. `drafts`,
-- `draft_picks` and `traded_picks` are all fantasy; everything in this file is
-- the real thing. Naming this one `draft_picks` was never available, and naming
-- it `player_draft` would have left the collision one careless import away.
--
-- No FK to `players`, the rule `player_week_stats` and `projections` already
-- keep: the crosswalk names players Sleeper's cache may not have yet (a rookie
-- between the draft and Sleeper's next refresh), and a row that has to wait for
-- the cache is a row that silently goes missing.

-- Up Migration

CREATE TABLE IF NOT EXISTS nfl_draft_picks (
    -- Sleeper's id, so every reader joins on the key it already holds.
    player_id VARCHAR(64) PRIMARY KEY,
    -- The draft class, always known for a stored row: a player with no class on
    -- file is not stored at all.
    draft_season VARCHAR(8) NOT NULL,
    -- Round, and the pick within it. Both null for an undrafted player, and
    -- both derived from the same row as `draft_overall` rather than computed
    -- from it — round sizes vary with compensatory picks, so the arithmetic
    -- would be wrong for exactly the players it was applied to.
    draft_round SMALLINT,
    draft_slot SMALLINT,
    -- The overall pick number. **NULL here means undrafted, not unknown** —
    -- that is the whole reason a row exists for a player it is null for. An
    -- unknown player has no row, so the two answers are distinguishable by the
    -- join alone, which is the `zero and absent are different answers` rule
    -- spelled as a schema rather than as a flag column that could disagree
    -- with the value beside it.
    draft_overall SMALLINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A stored row is either a complete drafted position or a complete
    -- undrafted one; a half-filled row would let a reader infer a round from a
    -- pick that isn't there. Enforced here because this table is written from a
    -- scraped crosswalk, where a partially-populated row is exactly what a
    -- source change looks like.
    CONSTRAINT nfl_draft_picks_complete CHECK (
        (draft_overall IS NULL AND draft_round IS NULL AND draft_slot IS NULL)
        OR (draft_overall IS NOT NULL AND draft_round IS NOT NULL)
    )
);

-- The class is what the deferred `rookie_season` question asks for, so it is
-- worth an index the day it exists rather than the day something joins on it.
CREATE INDEX IF NOT EXISTS nfl_draft_picks_season_idx
    ON nfl_draft_picks (draft_season);

-- Down Migration

DROP TABLE IF EXISTS nfl_draft_picks;
