-- Up Migration
-- What produced the rows in `player_seasons`, recorded by the loader that
-- wrote them.
--
-- **A comment in a migration is not provenance.** The one before this states
-- that the corpus is on "one scoring basis for the whole table, which the
-- loader states and does not mix" — and then the only place that basis was
-- ever stated was the comment itself. A reader looking at a PPG on the comps
-- page had no way to find out whether it was PPR, half-PPR or standard, and
-- neither had anybody debugging a comp that looked wrong. This is that
-- sentence turned into a row the app can read and print.
--
-- One row per corpus, keyed by name, rather than a single-row table with a
-- check constraint: the read is `WHERE corpus = 'player_seasons'` either way,
-- and a name leaves room for a second corpus to be recorded beside the first
-- rather than replacing it.
CREATE TABLE IF NOT EXISTS comps_corpus_meta (
    -- The table these rows describe. One name today.
    corpus TEXT PRIMARY KEY,
    -- The loader's own name for where the rows came from, e.g.
    -- `sleeper-season-stats`. Not a URL: a source is a pipeline rather than an
    -- endpoint, and the endpoint is the loader's business.
    source TEXT NOT NULL,
    -- The source's own version where it publishes one. Null is honest for a
    -- source that does not — see the loader.
    source_version TEXT,
    -- **The field this table exists for.** The fantasy scoring the `fantasy_pts`
    -- and `fantasy_ppg` columns are on: `half_ppr`, `ppr`, `std`. A corpus that
    -- cannot say which is a corpus whose points cannot be compared to anything,
    -- including the app's own projections.
    scoring TEXT NOT NULL,
    -- The loader/schema version the rows were written by, so a corpus written
    -- by an older loader can be told from one written by the current one
    -- without diffing the rows.
    loader_version TEXT NOT NULL,
    -- Every season the loader wrote in this load, ascending. **Not derived
    -- from the rows at read time**, and the difference is load-bearing: a
    -- season with rows is a season somebody played, and a season the loader
    -- *covered* is one where a player's absence is a measurement rather than a
    -- gap. `shared/player-seasons/corpus` reads exactly this distinction to
    -- decide whether a missing following season is a retirement or an unknown.
    seasons SMALLINT[] NOT NULL,
    min_season SMALLINT NOT NULL,
    -- The latest season the loader treats as a **complete** historical outcome.
    -- A season still being played is never written as one; see the loader's
    -- own season plan.
    max_completed_season SMALLINT NOT NULL,
    row_count INTEGER NOT NULL,
    player_count INTEGER NOT NULL,
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS comps_corpus_meta;
