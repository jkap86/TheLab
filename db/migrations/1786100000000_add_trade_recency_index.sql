-- Up Migration

-- The index `/api/trades` walks: completed trades, newest first.
--
-- `transactions` holds every roster move Sleeper reports — waivers, free-agent
-- claims, commissioner edits — and trades are a small minority of it, a few
-- percent once a database has crawled a season or two. The two indexes this
-- table already had are both `league_id`-leading, which is right for the sync
-- (it writes a league's week at a time) and useless to a read that wants the
-- whole database ordered by time: that read was a parallel sequential scan
-- discarding ~90% of every page it touched, then an external merge sort of what
-- survived.
--
-- Three things about the shape, each of which the query needs:
--
--   * **Partial**, on the same `type`/`status` pair the route filters by. That
--     is what keeps this a few MB against a table of millions, and it is the
--     whole selectivity win — the planner can read the index as "the trades"
--     rather than filtering them back out.
--   * **Ordered on `coalesce(status_updated, created)`**, an expression rather
--     than a column, because that coalesce *is* the board's ordering: Sleeper
--     stamps a completed trade with `status_updated` and leaves `created` as the
--     only timestamp on some older rows. `DESC NULLS LAST` matches the route's
--     `ORDER BY` exactly, which is what lets the sort be satisfied by the walk.
--   * **`transaction_id` as a second key**, so the ordering is total. The old
--     `ORDER BY` sorted on the timestamp alone, which is stable enough for one
--     cursor read and is not a key anything could resume from; carrying the
--     tiebreaker costs a few bytes a row and makes the order well-defined.
--
-- **The size of the win is worth stating honestly, because it is smaller than
-- the plan change suggests.** Measured against 1.6M transactions holding ~50k
-- trades for one season, on the exact SQL `shared/trades/queries` builds: the
-- season's whole walk 319ms → 286ms and its first chunk 190ms → 175ms (index
-- plus dropping the window count), and `count(*)` over the same population
-- 63ms → 56ms. What the index removes is the filtering — a parallel sequential
-- scan discarding ~95% of the rows it reads — and what it cannot remove is the
-- heap access, because trades are scattered through the table rather than
-- stored together: the sync writes a league's week at a time, so a season's
-- trades are interleaved with that season's waivers across every page. So the
-- bitmap scan still visits nearly as many pages as the sequential scan did.
--
-- It does not remove the sort either, and that is by design rather than a
-- shortfall. The route reads the whole season through a cursor with no `LIMIT`,
-- so the planner costs the plan for every row and takes the sort; only a
-- fast-start plan would walk this index in order, and `streamAllTrades`
-- documents why the walk that would need is the wrong trade.
--
-- The index earns its place anyway: the gain is consistent, it scales with how
-- much of the table *isn't* trades (which grows every season the crawler runs,
-- since trades are a fixed small share of roster moves), and it costs a few MB.
--
-- `league_id` is deliberately **not** INCLUDEd. It was tried: the count query
-- still takes a bitmap heap scan rather than an index-only one, because the
-- startup-draft boundary has to compare against the heap row anyway, so the
-- extra column bought nothing measurable and ~30% more index to keep written.
CREATE INDEX IF NOT EXISTS transactions_trade_recency_idx
    ON transactions ((coalesce(status_updated, created)) DESC NULLS LAST,
                     transaction_id DESC)
 WHERE type = 'trade' AND status = 'complete';

-- Down Migration
DROP INDEX IF EXISTS transactions_trade_recency_idx;
