-- Up Migration

-- The two indexes the ADP reads aggregate through. What they buy is the *heap
-- they avoid*, not a lookup — the joins were always indexed.
--
-- `draft_picks` carries Sleeper's per-pick `metadata` (first name, last name,
-- position, team — a few hundred bytes a row) and nothing reads it back out of
-- this database. It is stored because it arrived, which is right, and it makes
-- the table several times wider than the three columns an average needs. Both
-- ADP reads want `(draft_id, player_id, pick_no)` over most of a season's
-- picks, so each was reading the whole fat table to use a tenth of it: measured
-- over 1.5M picks in 8,000 leagues, 476MB of heap against a 46MB index that
-- answers the same question with `Heap Fetches: 0`.
--
-- **They are only a win alongside the materialized CTE in `shared/manager/adp`,
-- and on their own they are a regression** — 2,280ms to 2,900ms for the board
-- read. That is not a footnote, it is the thing to know before touching either
-- half: the covering index moves the planner from a hash join to a nested loop
-- with an index-only scan per draft, which is the cheaper shape *if* the
-- per-row work above it is cheap. With the JSONB board expression still being
-- re-evaluated per row per aggregate, the nested loop just does the expensive
-- thing more times. Materialized first, then indexed, the same read is 597ms.
-- Reverting the query without reverting these would make the board slower than
-- it was before either change.
--
-- `pick_no` rides in `INCLUDE` rather than as a key column: it is here to keep
-- the scan off the heap, not to order anything.

-- The board (`getDraftAdp`): joins `matched_drafts` on `draft_id`, groups by
-- `player_id`, averages `pick_no`. Partial on exactly the predicate the query
-- writes as constants, so the planner can match it — an unpicked slot is not a
-- pick and has no business in an average.
CREATE INDEX IF NOT EXISTS draft_picks_adp_board_idx
    ON draft_picks (draft_id, player_id) INCLUDE (pick_no)
 WHERE player_id IS NOT NULL AND player_id <> '';

-- Pricing a roster (`getDraftAdpForPlayers`): the same aggregate driven from
-- the other end, `player_id = ANY(…)` over every player on every roster of a
-- manager's leagues. Deliberately **not** partial: a partial index is only
-- usable where the planner can prove the predicate, and it cannot prove that a
-- bound array of ids excludes the empty string — a partial index here would
-- simply never be used, which is the failure that looks like a working
-- migration.
--
-- It replaces `draft_picks_player_idx`, which is its own leading column: that
-- index found the drafts and then went to the heap for the draft id and the
-- pick number, which is the read being removed. Keeping both would pay twice on
-- every crawled draft to write a prefix. The heap fetches are also where that
-- read's *variance* came from — 573ms, 1,094ms and 13,978ms on three runs of
-- one query, against 489/406/398ms index-only — and a read whose worst case is
-- twenty times its best is one that meets a statement timeout eventually.
CREATE INDEX IF NOT EXISTS draft_picks_adp_player_idx
    ON draft_picks (player_id, draft_id) INCLUDE (pick_no);

DROP INDEX IF EXISTS draft_picks_player_idx;

-- Down Migration
CREATE INDEX IF NOT EXISTS draft_picks_player_idx ON draft_picks (player_id);
DROP INDEX IF EXISTS draft_picks_adp_player_idx;
DROP INDEX IF EXISTS draft_picks_adp_board_idx;
