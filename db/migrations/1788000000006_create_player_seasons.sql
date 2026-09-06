-- Up Migration
-- One row per player per season: the corpus the comps page compares against.
-- Nothing in this schema held season stats before it — every other table is a
-- mirror of Sleeper's league graph or of KeepTradeCut's board, and a comp is a
-- question about a season that ended years ago.

-- The comps corpus behind `/comps`.
--
-- **The column list is the criteria table**, and nothing else: eleven things
-- a reader can weight, read off thirteen columns (`rec_yards` and `rec` are
-- one criterion), plus the identity and the finish's inputs. A column no
-- criterion reads is not here, on the same rule that keeps `players.data`
-- JSONB until something filters on it.
--
-- **Nothing here is written by the app.** The source is nfl_data_py's
-- seasonal data plus Sleeper's stats, per the handoff, and the loader that
-- joins them is a script rather than a sync loop — the corpus changes once a
-- year, when a season ends. Until it runs the table is empty, and the page
-- answers from a sample corpus and says so; see `shared/player-seasons/read`.
CREATE TABLE IF NOT EXISTS player_seasons (
    -- The Sleeper id where the loader can crosswalk one, since that is what
    -- lets a subject be priced off `ktc_values.sleeper_id` and named off
    -- `players`. Not a foreign key: a 2018 season names players the current
    -- map has never held, and a row the map cannot vouch for is still a season
    -- somebody played.
    player_id VARCHAR(64) NOT NULL,
    season SMALLINT NOT NULL,
    -- **Stored rather than joined from `players`.** That map is Sleeper's
    -- *current* players, and the players a 2018 comp names have often left it;
    -- the name is a fact the loader has at load time and the row is the only
    -- place it survives.
    player_name VARCHAR(255) NOT NULL,
    position VARCHAR(16) NOT NULL,
    -- Age *at* that season, to the tenth if the source has it. The distance
    -- reads it as a number, so it is not derived from a birth date at read
    -- time — two derivations of "how old was he" is a comp whose age disagrees
    -- with its own card.
    age NUMERIC(4, 1) NOT NULL,
    -- Seasons of experience *entering* that season; a rookie is 0.
    experience SMALLINT NOT NULL,
    -- Overall draft pick, **null for an undrafted player**. The distance reads
    -- a null as pick 260 — "after everyone", which is an ordinal position on
    -- the board rather than an absence — and the page prints it as `UDFA`. A
    -- stored 260 would be a claim that somebody drafted him there.
    draft_pick SMALLINT,
    games SMALLINT NOT NULL,
    -- Fantasy points and points per game on **one scoring basis for the whole
    -- table**, which the loader states and does not mix: the sample corpus is
    -- half-PPR, and a table holding two bases is two corpora that would rank
    -- against each other. Kept as columns rather than derived from the
    -- components below, because the components below are not the whole of a
    -- scoring system (no TDs, no fumbles) and a derivation would be a third
    -- basis nobody chose.
    fantasy_pts NUMERIC(6, 1) NOT NULL,
    fantasy_ppg NUMERIC(5, 2) NOT NULL,
    rec SMALLINT NOT NULL,
    rec_yards SMALLINT NOT NULL,
    -- **Nullable, and null is not zero.** Target share, yards per route run
    -- and snap share are not in the source for every season and position, and
    -- a null excludes that criterion for that row rather than z-scoring as a
    -- zero — see `shared/comps/knn`. Stored as percentages (0–100) where they
    -- are shares, the way the page prints them.
    target_share NUMERIC(5, 2),
    rush_yards SMALLINT NOT NULL,
    rush_att SMALLINT NOT NULL,
    yprr NUMERIC(4, 2),
    snap_share NUMERIC(5, 2),
    PRIMARY KEY (player_id, season)
);

-- The pool filter: a subject's position over a season range. The read today
-- takes the table whole and filters in process, which at a few thousand rows
-- is the cheaper answer; this is what a `WHERE` walks the day it is not.
CREATE INDEX IF NOT EXISTS player_seasons_position_season_idx
    ON player_seasons (position, season);

-- Down Migration
DROP INDEX IF EXISTS player_seasons_position_season_idx;
DROP TABLE IF EXISTS player_seasons;
