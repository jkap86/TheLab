-- Up Migration

-- The index `/api/trades` *resumes* on, now that the route is a keyset walk
-- rather than one cursor over the whole season.
--
-- `transactions_trade_recency_idx` (the migration before this one) is ordered on
-- `coalesce(status_updated, created) DESC NULLS LAST`, which matched the old
-- route's `ORDER BY` exactly. A keyset page cannot resume on that expression:
-- the resume predicate is a row comparison, and `NULLS LAST` is not something a
-- `<` can express — `(x, id) < ($1, $2)` is null-propagating for a null `x`, so
-- the undated tail would silently be skipped rather than sorted last.
--
-- Folding the null into the expression fixes it without changing the ordering.
-- Sleeper's epochs are positive milliseconds, so `coalesce(…, 0)` sorts the
-- undated rows exactly where `NULLS LAST` put them, and the resume predicate
-- becomes an ordinary total order on `(bigint, text)`.
--
-- Three things about the shape, each of which the paginated query needs:
--
--   * **Partial**, on the same `type`/`status` pair the route filters by —
--     trades are a few percent of a table that is otherwise waivers and
--     free-agent claims, so this stays a few MB while letting the planner read
--     the index as "the trades".
--   * **Ordered exactly as the route orders**, both keys DESC, so a
--     `LIMIT`-bounded page is a fast-start ordered index walk with no sort at
--     all. That is the whole point of the change: the old route had no `LIMIT`,
--     so the planner costed the plan for every row and took the sort; a page of
--     200 stops after 200 index entries.
--   * **`transaction_id` as the tiebreaker**, which is what makes the order
--     total and therefore resumable. Without it a page boundary landing inside
--     a group of trades sharing a timestamp drops and duplicates rows across
--     the seam.
CREATE INDEX IF NOT EXISTS transactions_trade_keyset_idx
    ON transactions ((coalesce(status_updated, created, 0)) DESC,
                     transaction_id DESC)
 WHERE type = 'trade' AND status = 'complete';

-- The player filter's index: `adds ?| array[…]` / `?& array[…]` are jsonb key
-- existence, which only the default `jsonb_ops` GIN opclass answers.
--
-- Partial on the same predicate for the same reason — `adds` on a waiver claim
-- is as big as `adds` on a trade and there are twenty times as many of them, so
-- indexing the whole column would cost twenty times the storage for rows this
-- read can never return. Restricted to trades it is small enough to be worth
-- keeping written, and it turns "every trade Ja'Marr Chase was in" from a scan
-- of the season into a handful of heap fetches.
CREATE INDEX IF NOT EXISTS transactions_trade_adds_idx
    ON transactions USING GIN (adds)
 WHERE type = 'trade' AND status = 'complete';

-- Down Migration
DROP INDEX IF EXISTS transactions_trade_adds_idx;
DROP INDEX IF EXISTS transactions_trade_keyset_idx;
