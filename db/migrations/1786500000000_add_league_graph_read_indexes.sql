-- Up Migration

-- Four indexes for the reads in `shared/manager/queries` and
-- `shared/trades/{queries,sql}`, each replacing a scan those queries were doing
-- on every request. None of them changes a result — they change which plan
-- answers it — so the SQL above them is untouched.

-- **The startup-draft boundary, which every trades read derives.**
--
-- `STARTUP_DRAFT_SQL` is `DISTINCT ON (league_id) … ORDER BY league_id,
-- start_time ASC NULLS LAST, draft_id` over the season's inaugural leagues, and
-- it is a CTE, so it is computed once per query — by the board's page read, by
-- both denominators, by the league list and by each of the three facet
-- branches. With only `drafts_league_idx` on `(league_id)` that is: an index
-- scan per league, a heap fetch per draft for `last_picked`/`status`, and then
-- a sort of the lot to satisfy the `DISTINCT ON`.
--
-- The full key makes the sort disappear (the index is already in `DISTINCT ON`
-- order) and the INCLUDE makes it index-only, so the two payload columns come
-- off the index page the walk is already on. Measured on 4,000 drafts across
-- 3,000 leagues: **5.1ms and 2,786 buffers → 2.6ms and 1,418 buffers**, on a
-- fragment that is a fixed cost of every one of those reads.
--
-- `NULLS LAST` is written out because it is the non-default for an ASC index
-- and the ordering it has to match says so: a draft Sleeper gave no
-- `start_time` is the fallback, never the answer.
CREATE INDEX IF NOT EXISTS drafts_league_start_idx
    ON drafts (league_id, start_time ASC NULLS LAST, draft_id)
 INCLUDE (last_picked, status);

-- **Roster-by-owner, with the league beside it.**
--
-- Every read that answers "this manager's leagues" opens with
-- `FIELDED_A_TEAM_SQL`, whose first half is `EXISTS (SELECT 1 FROM rosters
-- WHERE league_id = l.league_id AND owner_id = $1)` — both columns bound, and
-- neither existing index carried both: the primary key leads with `league_id`
-- and `rosters_owner_idx` held `owner_id` alone, so the planner either
-- bitmap-ANDed the two or fetched a league's dozen heap rows to check an owner.
-- The same pair is bound by the trades board's manager filter and by its
-- `traders` circle, per candidate trade, which is where it is paid the most
-- times.
--
-- `INCLUDE (roster_id)` is what those last two want: they need the roster id and
-- nothing else off the row, so the subquery never leaves the index.
--
-- It **replaces** `rosters_owner_idx` rather than sitting beside it. That index
-- is a strict prefix of this one, so every plan that could use it can use this;
-- keeping both would cost a second index write on every roster upsert, and the
-- crawler rewrites a league's rosters on each refresh.
CREATE INDEX IF NOT EXISTS rosters_owner_league_idx
    ON rosters (owner_id, league_id) INCLUDE (roster_id);
DROP INDEX IF EXISTS rosters_owner_idx;

-- **The same table read from the other end: a roster named by a trade.**
--
-- The board's manager filter and its `traders` circle both resolve
-- `roster_ids → owner` per candidate trade, which is a lookup on the primary
-- key's own columns and then a heap fetch for the one column the key does not
-- carry. Over a count — where there is no `LIMIT` to stop the walk, so the
-- subquery runs for every trade in the season — that heap fetch is the query:
-- the leaguemates circle's count spent 728k buffer hits in it.
--
-- The primary key cannot be widened in place, so this is the same key with
-- `owner_id` carried alongside, which makes the lookup index-only. Measured on
-- 1.2M transactions with 1,440 leaguemates: the `leaguemates` circle's count
-- **1,443ms → 854ms** and the `leaguemate-leagues` circle's **218ms → 108ms**.
-- It is an addition rather than a replacement — the primary key is still what
-- enforces one roster per id — and it is small and rarely written: a league's
-- dozen rosters, rewritten on that league's crawl tick.
CREATE INDEX IF NOT EXISTS rosters_league_roster_owner_idx
    ON rosters (league_id, roster_id) INCLUDE (owner_id);

-- **The inaugural leagues of a season**, which is the outer half of the startup
-- CTE above.
--
-- `leagues_season_idx` answers the season, and the `previous_league_id` test is
-- then a filter over every league in it — 2,334 rows discarded out of 3,000 in
-- the measurement above. Partial on the same expression the CTE writes (all
-- three spellings Sleeper has used for "no previous season"), so the index *is*
-- the set of leagues that can carry a startup boundary. It stays small for the
-- same reason it is useful: a continuing dynasty league is not in it.
CREATE INDEX IF NOT EXISTS leagues_startup_season_idx
    ON leagues (season)
 WHERE coalesce(previous_league_id, '') IN ('', '0');

-- Down Migration
CREATE INDEX IF NOT EXISTS rosters_owner_idx ON rosters (owner_id);
DROP INDEX IF EXISTS rosters_league_roster_owner_idx;
DROP INDEX IF EXISTS leagues_startup_season_idx;
DROP INDEX IF EXISTS rosters_owner_league_idx;
DROP INDEX IF EXISTS drafts_league_start_idx;
