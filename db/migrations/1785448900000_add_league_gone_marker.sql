-- Up Migration

-- When Sleeper stopped serving a stored league (200 with a null body — a
-- deleted league), stamped by the crawler's refresh pass. Null for a league
-- Sleeper still answers for.
--
-- Without it a deleted league is due forever: its `updated_at` never advances,
-- so it permanently occupies one of the refresh batch's claim slots and costs
-- one Sleeper request per rotation, crowding live leagues out as deletions
-- accumulate. The crawler skips marked leagues; the row and its drafts stay —
-- they still feed ADP — and a manager-driven sync that finds the league alive
-- again clears the marker (see persistLeagueGraph's upsert).
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS gone_at TIMESTAMPTZ;

-- Down Migration
ALTER TABLE leagues DROP COLUMN IF EXISTS gone_at;
