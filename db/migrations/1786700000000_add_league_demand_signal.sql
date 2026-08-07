-- Up Migration

-- When somebody last actually looked at this league.
--
-- **The crawler's refresh queue is strictly oldest-first, and that stops being
-- the right order once the corpus outgrows the freshness target.** The batch
-- retires `CRAWL_LEAGUE_BATCH` leagues a minute, so the 15-minute in-season TTL
-- is honourable to ~225 leagues; at a thousand a full rotation is over an hour,
-- and every league in it is treated identically — the league a reader has open
-- and a league discovered three hops out through a stranger's membership wait
-- the same amount of time behind the same queue.
--
-- This is the smallest signal that can tell them apart. It is stamped where
-- demand is *observed* rather than inferred: a manager's league sync (someone
-- searched them) and a league detail read (someone opened its panel). It is
-- deliberately not stamped by the crawler itself, which would make every league
-- look demanded within one rotation and flatten the ordering back out.
--
-- Null is the ordinary state for a discovered league and reads as "nobody has
-- asked for this one", which is the coldest tier rather than a missing value.
-- See `shared/manager/crawl-priority.ts` for the tiers and for the starvation
-- bound that keeps a cold league from waiting forever behind hot ones.
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

-- The claim query orders by a `CASE` over `(updated_at, last_accessed_at,
-- status)` and then by `sync_attempt_at`, all inside one season's due leagues.
-- There is no index that serves an expression like that as an ordered walk, and
-- one is not what this needs: the sort input is a season's *due* rows, which the
-- freshness TTL keeps small by construction (it is the backlog the scheduler
-- warns when it cannot keep up with). What is worth indexing is finding those
-- rows, which is what this covers — `leagues_sync_attempt_idx` beside it stays
-- the access path for the un-prioritised ordering the down migration restores.
CREATE INDEX IF NOT EXISTS leagues_season_due_idx
    ON leagues (season, updated_at)
 WHERE gone_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS leagues_season_due_idx;
ALTER TABLE leagues DROP COLUMN IF EXISTS last_accessed_at;
