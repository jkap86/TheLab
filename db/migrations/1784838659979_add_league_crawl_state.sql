-- Up Migration
-- Bookkeeping for the background league crawl (see src/shared/manager/crawl.ts),
-- which re-syncs stored leagues and walks league members to discover new ones.

-- When the crawler last TRIED this league, success or not. It orders the refresh
-- queue (not `updated_at`) so a league whose fetch keeps failing rotates to the
-- back instead of being retried every tick ahead of everyone else. `updated_at`
-- stays the freshness signal: persistLeagueGraph is the only writer of this row.
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS sync_attempt_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS leagues_sync_attempt_idx
    ON leagues (season, sync_attempt_at ASC NULLS FIRST);

-- Same idea on the manager side of the crawl, which enumerates a member's
-- leagues looking for ones we have never seen.
--
-- `synced_at` keeps its meaning — "this manager's full league graph was synced"
-- — and stays owned by syncManagerLeagues, so the leagues route's cache TTL is
-- never fooled by a discovery pass. That makes it nullable: a row with
-- `attempt_at` set and `synced_at` NULL is a member we have crawled for
-- discovery but never fully synced, which the route correctly reads as no cache.
ALTER TABLE manager_syncs ALTER COLUMN synced_at DROP DEFAULT;
ALTER TABLE manager_syncs ALTER COLUMN synced_at DROP NOT NULL;
ALTER TABLE manager_syncs ADD COLUMN IF NOT EXISTS attempt_at TIMESTAMPTZ;
UPDATE manager_syncs SET attempt_at = synced_at WHERE attempt_at IS NULL;
CREATE INDEX IF NOT EXISTS manager_syncs_attempt_idx
    ON manager_syncs (season, attempt_at ASC NULLS FIRST);

-- Down Migration
DROP INDEX IF EXISTS manager_syncs_attempt_idx;
ALTER TABLE manager_syncs DROP COLUMN IF EXISTS attempt_at;
-- Discovery-only rows have no synced_at; stamp them so NOT NULL can come back.
UPDATE manager_syncs SET synced_at = now() WHERE synced_at IS NULL;
ALTER TABLE manager_syncs ALTER COLUMN synced_at SET NOT NULL;
ALTER TABLE manager_syncs ALTER COLUMN synced_at SET DEFAULT now();
DROP INDEX IF EXISTS leagues_sync_attempt_idx;
ALTER TABLE leagues DROP COLUMN IF EXISTS sync_attempt_at;
