-- Up Migration
-- What the trades board reads: the players it names, the indexes it walks, and
-- the (trade, roster) → owner mapping it filters by.
--
-- No new *trade* storage: a trade is a `transactions` row with `type = 'trade'`
-- and `status = 'complete'`, mirrored by the league sync since the graph landed.
-- What was missing is the read side — this file is all of it.

-- Sleeper's global NFL players map (/v1/players/nfl, ~12k entries, ~5MB),
-- refreshed at most once a day by `src/shared/players`. `full_name` is null for
-- team defenses (keyed by team abbreviation); the full payload is kept in
-- `data`.
--
-- **The trades board is what forces this table.** Until now the only name
-- source in the app was the projections feed, which answers for the current
-- season's rostered players — and a trade list is history: a 2021 trade names
-- players who have since retired, and a feed with no row for them can only
-- print an id. Names for everyone who has ever been traded is a table or it is
-- nothing.
--
-- `data` is kept whole rather than trimmed to the columns above for the reason
-- the KTC scrape keeps its own: re-downloading the past is not an option, and
-- the Sleeper↔KTC name matcher that `ktc_values.sleeper_id` is waiting for
-- reads fields (birth date, college, the alternate id maps) that nothing
-- columns today.
CREATE TABLE IF NOT EXISTS players (
    player_id VARCHAR(64) PRIMARY KEY,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    full_name VARCHAR(255),
    position VARCHAR(16),
    team VARCHAR(16),
    fantasy_positions JSONB,
    status VARCHAR(32),
    sport VARCHAR(16),
    -- Promoted out of `data` because the rookie class is filtered on rather
    -- than displayed — the ADP board's rookie ladder is the reader that wants
    -- it, and the house rule is that a nested field stays JSONB until something
    -- joins or filters on it. It ships columned here rather than as a later
    -- ALTER because there is no stored corpus to backfill from yet.
    years_exp SMALLINT,
    data JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS players_position_idx ON players (position);
CREATE INDEX IF NOT EXISTS players_team_idx ON players (team);

-- The index the windowed reads walk: completed trades, newest first.
--
-- `transactions` holds every roster move Sleeper reports — waivers, free-agent
-- claims, commissioner edits — and trades are a small minority of it. The two
-- indexes this table already has are both `league_id`-leading, which is right
-- for the sync (it writes a league's week at a time) and useless to a read that
-- wants the whole database ordered by time.
--
-- Three things about the shape, each of which the query needs:
--
--   * **Partial**, on the same `type`/`status` pair the route filters by. That
--     is the whole selectivity win — the planner reads the index as "the
--     trades" rather than filtering them back out.
--   * **Ordered on `coalesce(status_updated, created)`**, an expression rather
--     than a column, because that coalesce *is* the board's ordering: Sleeper
--     stamps a completed trade with `status_updated` and leaves `created` as
--     the only timestamp on some older rows. `DESC NULLS LAST` matches the
--     window reads' `ORDER BY` exactly.
--   * **`transaction_id` as a second key**, so the ordering is total.
--
-- It is the *counts and facets* index; the keyset walk below is the page's.
-- Both are kept because they answer different predicates: this one serves the
-- range comparisons on the two-argument coalesce that `sql.ts` writes for the
-- date window.
CREATE INDEX IF NOT EXISTS transactions_trade_recency_idx
    ON transactions ((coalesce(status_updated, created)) DESC NULLS LAST,
                     transaction_id DESC)
 WHERE type = 'trade' AND status = 'complete';

-- The index a page *resumes* on.
--
-- A keyset page cannot resume on the expression above: the resume predicate is
-- a row comparison, and `NULLS LAST` is not something a `<` can express —
-- `(x, id) < ($1, $2)` is null-propagating for a null `x`, so the undated tail
-- would silently be skipped rather than sorted last. Folding the null into the
-- expression fixes it without changing the ordering: Sleeper's epochs are
-- positive milliseconds, so `coalesce(…, 0)` sorts the undated rows exactly
-- where `NULLS LAST` put them, and the resume predicate becomes an ordinary
-- total order on `(bigint, text)`.
--
-- Ordered exactly as the route orders, both keys DESC, so a `LIMIT`-bounded
-- page is a fast-start ordered index walk with no sort at all — a page of 100
-- stops after 100 index entries.
CREATE INDEX IF NOT EXISTS transactions_trade_keyset_idx
    ON transactions ((coalesce(status_updated, created, 0)) DESC,
                     transaction_id DESC)
 WHERE type = 'trade' AND status = 'complete';

-- The player filter's index: `adds ?| array[…]` / `?& array[…]` are jsonb key
-- existence, which only the default `jsonb_ops` GIN opclass answers.
--
-- Partial on the same predicate for the same reason — `adds` on a waiver claim
-- is as big as `adds` on a trade and there are many times as many of them, so
-- indexing the whole column would cost that multiple for rows this read can
-- never return. Restricted to trades it turns "every trade this player was in"
-- from a scan of the season into a handful of heap fetches.
CREATE INDEX IF NOT EXISTS transactions_trade_adds_idx
    ON transactions USING GIN (adds)
 WHERE type = 'trade' AND status = 'complete';

-- **A roster named by a trade**, read from the roster side.
--
-- The board's manager filter resolves `roster_ids → owner` per candidate trade,
-- which on the primary key alone is a lookup and then a heap fetch for the one
-- column the key does not carry. Over a count — where there is no `LIMIT` to
-- stop the walk — that heap fetch is the query. This is the same key with
-- `owner_id` carried alongside, which makes the lookup index-only. It is an
-- addition rather than a replacement: the primary key still enforces one roster
-- per id, and `rosters_owner_league_idx` still answers the other direction.
CREATE INDEX IF NOT EXISTS rosters_league_roster_owner_idx
    ON rosters (league_id, roster_id) INCLUDE (owner_id);

-- Who was party to a trade, as rows instead of as a per-request derivation.
--
-- "Was one of these managers in this trade" is the board's most expensive
-- question. A trade names *rosters* (`transactions.roster_ids`, a jsonb array
-- Sleeper has sent as both numbers and strings) and a reader names *people*, so
-- every read that asks it must unnest that array, cast each element through a
-- regex guard, and look the roster up — per candidate trade, with no `LIMIT` to
-- stop it on the reads that matter most: the `leaguemates` circle, the managers
-- facet, and both denominators. A jsonb array cannot be joined to, so without
-- this table the mapping is re-derived for every trade on every read.
--
-- ## What the rows mean
--
-- One row per (trade, roster) pair of every **complete trade**, carrying the
-- roster's owner as `rosters` holds it *now*. Both consequences are properties
-- of the derivation this replaces rather than new decisions:
--
--   * **Current ownership, not ownership at the time.** A roster that changes
--     hands changes who its past trades are attributed to. That is what the
--     join always did, and it is the only thing that can be answered: Sleeper
--     publishes no ownership history.
--   * **A roster with no owner is absent, not null.** An orphan roster names
--     nobody, so it contributed nothing to the old `WHERE r.owner_id IS NOT
--     NULL` either.
--
-- ## Why it is safe to read
--
-- Because it is rebuilt inside the league graph's own transaction
-- (`writeLeagueGraph` → `rebuildTradeParticipants`), so it commits with the
-- rows it describes or not at all. A missing participant row makes a trade
-- **invisible** to the circle that should have found it, and a derived table
-- the reads filter on cannot be eventually consistent. The same rule is why
-- this migration backfills rather than letting the table fill in as leagues are
-- next synced: the reads switch over the moment the code deploys.
CREATE TABLE IF NOT EXISTS trade_participants (
    transaction_id VARCHAR(255) NOT NULL,
    -- **The league is the only foreign key, and the absence of one on
    -- `transaction_id` is deliberate.** `writeLeagueGraph` refreshes
    -- transactions by deleting a week range and re-inserting it, so a cascade
    -- from that table would throw these rows away mid-transaction on every
    -- sync; they are rebuilt from the committed rows a moment later either way.
    -- Cascading from `leagues` is right for the reason it is right everywhere
    -- else in the graph: a league that goes takes its trades with it.
    league_id VARCHAR(255) NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    roster_id INTEGER NOT NULL,
    -- NOT NULL because an orphan roster is left out rather than stored as one:
    -- absent and "owned by nobody" are the same answer here, and one spelling
    -- is what keeps a reader from having to know that.
    owner_id VARCHAR(255) NOT NULL,
    -- `INCLUDE (owner_id)` is the point of the key, not a decoration. Every
    -- read arrives holding a `transaction_id` and asking about the owner, so
    -- carrying it on the index page makes the lookup index-only.
    PRIMARY KEY (transaction_id, roster_id) INCLUDE (owner_id)
);

-- The same table read from the other end: every trade a set of managers was in.
--
-- The circle's filter is written correlated (`tp.transaction_id =
-- t.transaction_id`) so it stays a function of `t` and the board's `ORDER BY`
-- keeps coming off `transactions_trade_keyset_idx` — see `shared/trades/sql`
-- for what decorrelating that subquery costs. The reads with no `ORDER BY` at
-- all (the facets, both denominators) have no such constraint, and this is what
-- lets the planner drive from the manager side when that is cheaper.
CREATE INDEX IF NOT EXISTS trade_participants_owner_idx
    ON trade_participants (owner_id, transaction_id);

-- The per-league rebuild's own access path: `writeLeagueGraph` replaces this
-- league's rows wholesale on every sync, which is a delete by league first.
CREATE INDEX IF NOT EXISTS trade_participants_league_idx
    ON trade_participants (league_id);

-- The backfill.
--
-- Deliberately the whole corpus rather than the active season: a tombstoned
-- league is never synced again and its trades stay on the board (that is what
-- `gone_at` keeps the row for), so a season-scoped backfill would retire those
-- trades from every manager-scoped read, permanently and silently.
--
-- `DISTINCT` rather than `ON CONFLICT DO NOTHING` because the duplicate this
-- guards against is *within* the statement — a `roster_ids` array naming the
-- same roster twice — and `ON CONFLICT` does not cover that case; Postgres
-- refuses the whole command with "cannot affect row a second time".
--
-- The expression below must stay textually the one `tradeParticipantsSql`
-- builds in `src/shared/trades/sql.ts` — the sync rebuilds these rows with it,
-- so two spellings would mean the backfill and every refresh after it
-- disagreeing about who was in a trade. `sql.test.ts` pins the two together by
-- reading this file.
INSERT INTO trade_participants (transaction_id, league_id, roster_id, owner_id)
SELECT DISTINCT t.transaction_id, t.league_id, r.roster_id, r.owner_id
  FROM transactions t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(t.roster_ids) = 'array' THEN t.roster_ids ELSE '[]'::jsonb END
  ) ri
  JOIN rosters r
    ON r.league_id = t.league_id
   AND r.roster_id = (CASE WHEN ri ~ '^[0-9]+$' THEN ri::int END)
 WHERE t.type = 'trade' AND t.status = 'complete'
   AND r.owner_id IS NOT NULL;

-- Creating a table collects no statistics, and the planner's default guess for
-- a semi-join against an empty-looking relation is how a filter becomes a
-- nested loop over the season. The rows are here now, so they are analysed
-- here.
ANALYZE trade_participants;

-- Down Migration
DROP TABLE IF EXISTS trade_participants;
DROP INDEX IF EXISTS rosters_league_roster_owner_idx;
DROP INDEX IF EXISTS transactions_trade_adds_idx;
DROP INDEX IF EXISTS transactions_trade_keyset_idx;
DROP INDEX IF EXISTS transactions_trade_recency_idx;
DROP TABLE IF EXISTS players;
