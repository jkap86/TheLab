-- How many times a `(season, week)` has answered successfully but empty.
--
-- `stat_week_syncs` stamps the *attempt*, which is what lets an unplayed or
-- unsupported week stop being refetched every tick. On the archive tier that
-- stamp is permanent by design — a season Sleeper does not carry answers
-- eighteen empty weeks, and each must cost one probe for the lifetime of the
-- database rather than one per tick forever.
--
-- The gap that closes here is that "successful but empty" is not proof of
-- anything. A 200 carrying only placeholders is what an unsupported season
-- looks like *and* what a bad minute upstream looks like, so one blip during
-- the initial backfill retired a week that had real historical data —
-- permanently, silently, and only visible as a hole in the comps corpus years
-- later. Counting the observations lets the two be told apart: see
-- `src/shared/stats/archive-clock.ts`, which owns the rule and the SQL that
-- reads this column.
--
-- Zero means the last successful fetch stored rows, which is why it is the
-- default and why a non-empty write resets it: a week that recovers is retired
-- as a stored week rather than carrying a stale observation forward.

-- Up Migration

ALTER TABLE stat_week_syncs
    ADD COLUMN IF NOT EXISTS empty_observations SMALLINT NOT NULL DEFAULT 0;

-- Existing stamps carry no history, so the count is reconstructed from the one
-- thing that does: whether the week actually stored anything. A stamped week
-- with no rows answered empty at least once, and giving it exactly one
-- observation is what buys back a single confirming probe — which is how a week
-- retired by a transient empty during the initial backfill is healed rather
-- than left as a permanent hole. A stamped week with rows keeps the default 0
-- and is never refetched.
--
-- This also touches live and settled weeks that have not been played yet; they
-- are gated on `synced_at` against a real TTL and never read this column, so
-- the value is inert for them.
UPDATE stat_week_syncs s
   SET empty_observations = 1
 WHERE NOT EXISTS (
       SELECT 1
         FROM player_week_stats p
        WHERE p.season = s.season
          AND p.week = s.week);

-- Down Migration

ALTER TABLE stat_week_syncs DROP COLUMN IF EXISTS empty_observations;
