-- Up Migration

-- **Teach the planner what the scoring bucket actually selects.**
--
-- Every ADP read matches drafts through `matchedDraftsSql`, whose `WHERE`
-- carries `SCORING_SQL = ANY(...)` — a JSONB extraction, a regex and a CASE.
-- Postgres keeps no statistics for an expression like that, so it falls back to
-- its default equality guess of 0.005 and estimated **9 rows** where the CTE
-- returns 1,400–3,800. Every board came out at the same 9, because the guess is
-- a constant and has nothing to do with the board being asked for.
--
-- What that estimate buys is the wrong plan. At 9 rows a nested loop over
-- `draft_picks` looks free, so one board of a manager's ADP valuation ran 1,404
-- loops of an index scan over a 164-player `= ANY`, 719k buffer hits and a
-- `GroupAggregate` whose sort spilled to disk having budgeted for 550 rows
-- against 146,139 actual: 1,150ms for a query the same shape answers in 163ms
-- once the estimate is honest. Measured on 1.9M picks in 14.5k drafts:
--
--   * `/api/user/[username]/adp-value` — the slow board 1,170ms → 163ms, and
--     the whole request 1,803ms → ~700ms, of which the ADP half was 96%.
--   * `/api/adp`'s own board read — 873ms → 287ms.
--
-- Three things are worth knowing before touching this.
--
-- **It is the scoring expression alone, and that is measured rather than
-- minimal.** The same `WHERE` carries `SUPERFLEX_SQL`, and statistics on it
-- change nothing further (163ms either way) — the scoring guess was the entire
-- error, since 3,646 estimated drafts × 0.005 × the 0.5 a boolean expression is
-- assumed to select is exactly the 9 that came out. Superflex could not be
-- added anyway without rewriting it: it counts QB slots with a sub-select, and
-- `CREATE STATISTICS` rejects a sublink outright (`0A000`). Leaving it alone is
-- what keeps this migration free of any change to what the two classifiers
-- mean.
--
-- **The expression has to stay textually the expression in `SCORING_SQL`.**
-- The planner matches a statistics object to a predicate by comparing parsed
-- expression trees, so a change to the buckets, the regex or the thresholds in
-- `shared/manager/adp.ts` silently stops this being used — no error, no
-- warning, just the 0.005 guess and the nested loop back. The alias differs on
-- purpose (`scoring_settings` here, `l.scoring_settings` there) because that is
-- the one part of the tree the comparison does not carry.
--
-- **This is not a substitute for `AS MATERIALIZED`.** Inlining that CTE is
-- still twice as slow again (2,252ms on the same board) for the reason written
-- on `matchedDraftsSql`: the two fix different halves — that keyword stops the
-- expression being recomputed per pick per aggregate, this stops the row count
-- above it being a fiction.
CREATE STATISTICS IF NOT EXISTS leagues_scoring_bucket_stats ON (CASE
     WHEN scoring_settings->>'rec' !~ '^-?[0-9]+(\.[0-9]+)?$' THEN 'std'
     WHEN (scoring_settings->>'rec')::numeric >= 1 THEN 'ppr'
     WHEN (scoring_settings->>'rec')::numeric >= 0.5 THEN 'half_ppr'
     ELSE 'std'
   END) FROM leagues;

-- Statistics are collected by ANALYZE, not by their own creation, so without
-- this the fix would not land until autovacuum next reached the table — which
-- on a corpus that is only ever upserted can be a long time, and would make the
-- migration look like it had done nothing.
ANALYZE leagues;

-- Down Migration
DROP STATISTICS IF EXISTS leagues_scoring_bucket_stats;
