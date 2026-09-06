-- Up Migration
-- `player_seasons.draft_pick` was declared "null for an undrafted player", and
-- that collapsed two facts into one column: a player the source *knows* went
-- undrafted, and a player no source could say anything about. Under a loader
-- whose only source publishes no draft position at all — Sleeper's players map
-- — every row was the second, and every one was read and printed as the first:
-- a corpus of undrafted free agents, first-round picks included.
--
-- **Three states, two columns, one constraint.** `draft_pick` stays the overall
-- pick and is null wherever there is no pick to state; `undrafted` says whether
-- that null is a known outcome. A pick beside `undrafted = true` is a
-- contradiction the CHECK refuses rather than a state a reader has to choose an
-- interpretation for.
--
-- The default is `false`, and for once a default is the honest reading rather
-- than a claim: every row on file was written by a loader that could not know,
-- and "not known" is exactly what `false` beside a null pick means. The loader
-- writes the column explicitly on every row from here on, and its version moved
-- with this so the boot loop reloads the corpus rather than extending one whose
-- rows all mean "unknown".
ALTER TABLE player_seasons
    ADD COLUMN IF NOT EXISTS undrafted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE player_seasons
    DROP CONSTRAINT IF EXISTS player_seasons_draft_state;
ALTER TABLE player_seasons
    ADD CONSTRAINT player_seasons_draft_state
    CHECK (NOT (undrafted AND draft_pick IS NOT NULL));

-- Down Migration
ALTER TABLE player_seasons DROP CONSTRAINT IF EXISTS player_seasons_draft_state;
ALTER TABLE player_seasons DROP COLUMN IF EXISTS undrafted;
