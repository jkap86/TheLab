-- Withdraw the "this graph is complete" claim from every past season, once,
-- because the claim is about to start meaning something much stronger.
--
-- `managerSyncGate` now reads a season tier (src/shared/manager/sync-freshness.ts):
-- a finished season cannot change, so one *complete* sync of it is complete
-- forever and is never re-run on a clock. That retirement is only sound if what
-- is stored is actually whole — and until `graph-weeks` landed beside it, no
-- past season's was.
--
-- `syncLeagueGraphs` bounded both week-keyed collections (transactions,
-- matchups) by the week of the season the *app* is in, never the season being
-- synced. A 2024 league synced during an offseason therefore stored week 1 and
-- nothing else, and stayed there: the next pass read a stored max week of 1 and
-- computed max(currentWeek, stored) = 1 again. Mid-season it filled in lockstep
-- with the current week instead of its own, reaching week 18 in January.
--
-- Every one of those runs dropped no league, so every one of them stamped
-- `synced_at` — which the new tier reads as "complete, finished season, never
-- ask again". Without this the fix would never reach a row already written, and
-- the truncation would become permanent on the day it was repaired.
--
-- Nothing here is a background cost: the crawler only ever claims the active
-- season, so a past season is re-fetched only for a reader who opens it, once,
-- after which it retires honestly.
--
-- `attempt_at` is deliberately left alone. It carries the retry throttle rather
-- than the freshness claim, so clearing it would buy nothing and would put every
-- affected manager at the head of a queue ordered attempt-first.
--
-- The newest season in `leagues` stands in for the active season, which SQL has
-- no other way to know. It is the right bound either way — a season with no
-- leagues stored has no graph to repair — and an empty `leagues` makes the
-- comparison NULL, so a fresh database is untouched rather than wiped.

-- Up Migration

UPDATE manager_syncs
   SET synced_at = NULL
 WHERE synced_at IS NOT NULL
   AND season < (SELECT max(season) FROM leagues);

-- Down Migration

-- Irreversible by construction: the timestamps are gone, and inventing them
-- would re-assert exactly the claim this withdrew. What not reversing it costs
-- is one re-sync per manager per past season somebody opens — which is the whole
-- purpose of the up migration. A no-op is the honest down.
SELECT 1;
