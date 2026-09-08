-- Up Migration
-- Make a manager's Sleeper league enumeration authoritative for Manager scope.
--
-- `manager_league_order` has always been an enumeration snapshot: the manager's
-- own sync is its only writer and it replaces the whole (manager, season) set
-- in one transaction. What it could not do was answer "is this snapshot a
-- snapshot at all" — zero rows meant both "Sleeper confirmed this manager has
-- no leagues" and "nobody has ever enumerated them" — so nothing could be read
-- off it without risking a manager's whole list disappearing on a bad upstream
-- answer. That is the one bit this adds.
--
-- No new table: the rows are already the right rows, written by the right
-- writer, at the right grain. See CLAUDE.md, The manager's scope is the
-- enumeration.
ALTER TABLE manager_syncs ADD COLUMN IF NOT EXISTS scope_at TIMESTAMPTZ;

-- Backfill so the fix takes effect on stored data rather than only after every
-- manager's next sync. A (manager, season) that has order rows got them from a
-- wholesale replacement of a successful enumeration — that is the only way one
-- is ever written — so the snapshot is real and only its marker was missing.
-- A manager with no order rows is left unmarked, which reads as "never
-- enumerated" and falls back to the graph-derived scope exactly as today.
UPDATE manager_syncs ms
   SET scope_at = COALESCE(ms.synced_at, ms.attempt_at)
 WHERE ms.scope_at IS NULL
   AND COALESCE(ms.synced_at, ms.attempt_at) IS NOT NULL
   AND EXISTS (SELECT 1 FROM manager_league_order mo
                WHERE mo.user_id = ms.user_id AND mo.season = ms.season);

-- Down Migration
ALTER TABLE manager_syncs DROP COLUMN IF EXISTS scope_at;
