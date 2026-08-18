-- When each projections week was last *tried*, as against last fetched
-- successfully (see src/shared/projections/horizon-queue.ts).
--
-- `projection_week_syncs` was created to stamp a successful fetch whether or not
-- it returned rows, which fixed one half of a starvation: an unpublished week
-- used to read as never-synced, come due on every tick, and — because the
-- horizon budget takes the *earliest stale weeks first* — crowd published weeks
-- out of the per-tick cap indefinitely.
--
-- The other half was left open. A week whose fetch **fails**, or whose payload
-- the completeness gate **refuses**, deliberately stamps nothing so it stays
-- eager — and an unstamped week sorts to the front of an ascending-by-week
-- queue on every tick thereafter, forever. Two such weeks are the entire cap of
-- `HORIZON_WEEKS_PER_TICK`, so the rest of the season is never so much as
-- attempted and the backfill stops dead at whatever week it had reached. It
-- does not look like a stall: the near window keeps refreshing, the log keeps
-- reporting a failure for the same two weeks, and every rest-of-season number
-- downstream quietly describes a two-week horizon.
--
-- So freshness and rotation become two columns, the `manager_syncs`
-- `synced_at`/`attempt_at` split and the crawler's `sync_attempt_at`
-- tiebreaker. `synced_at` keeps its exact meaning and is still the only thing
-- the TTL gate reads, so a failure is still retried rather than waited out;
-- `attempt_at` advances on every attempt and orders the queue, so a week that
-- keeps failing rotates to the back of its own tier instead of holding the head
-- of it.

-- Up Migration

ALTER TABLE projection_week_syncs
    ADD COLUMN IF NOT EXISTS attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Existing rows only exist because a fetch succeeded, so that is when they were
-- last attempted. Without this every stored week would carry the migration's
-- own timestamp and the first horizon pass would order on nothing.
UPDATE projection_week_syncs SET attempt_at = synced_at;

-- `synced_at` must be able to say "never", now that a row can be written by an
-- attempt that did not succeed. Left NOT NULL with its `now()` default, an
-- attempt-only insert would stamp a week fresh for the whole TTL on the
-- strength of having failed — the loudest possible version of the bug this
-- migration exists to close.
ALTER TABLE projection_week_syncs ALTER COLUMN synced_at DROP DEFAULT;
ALTER TABLE projection_week_syncs ALTER COLUMN synced_at DROP NOT NULL;

-- Down Migration

ALTER TABLE projection_week_syncs ALTER COLUMN synced_at SET DEFAULT now();
UPDATE projection_week_syncs SET synced_at = attempt_at WHERE synced_at IS NULL;
ALTER TABLE projection_week_syncs ALTER COLUMN synced_at SET NOT NULL;
ALTER TABLE projection_week_syncs DROP COLUMN IF EXISTS attempt_at;
