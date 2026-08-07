-- Up Migration

-- Sleeper's `years_exp` promoted out of the `data` blob, because it is now
-- queried on: `/api/adp` marks the rookie class so the trades board can rank it
-- into a rookie-pick ladder (the k-th rookie off the board is rookie pick k).
-- The house rule for these payloads is that a nested field stays JSONB until
-- something filters or joins on it, and this one now does.
ALTER TABLE players ADD COLUMN IF NOT EXISTS years_exp SMALLINT;

-- Backfilled from the blob the sync has always stored, so no re-download of
-- Sleeper's ~5MB map is needed for the column to be useful. Regex-guarded before
-- the cast like every other numeric read off a Sleeper payload: the field is
-- absent for team defences and Sleeper promises nothing about its type.
UPDATE players
   SET years_exp = CASE
         WHEN data->>'years_exp' ~ '^[0-9]{1,2}$'
         THEN (data->>'years_exp')::smallint
       END
 WHERE years_exp IS NULL;

-- ~300 rookies out of ~12k players, read on every ADP board request.
CREATE INDEX IF NOT EXISTS players_years_exp_idx ON players (years_exp);

-- Down Migration
DROP INDEX IF EXISTS players_years_exp_idx;
ALTER TABLE players DROP COLUMN IF EXISTS years_exp;
