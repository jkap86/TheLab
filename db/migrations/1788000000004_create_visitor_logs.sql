-- Up Migration
-- One row per page request the proxy sees: who was looking, where they went,
-- and when. Nothing in this app recorded a visit before it.

-- The visit log behind `/logs`.
--
-- **The route is stored whole and everything about it is derived at read time**
-- — which tool, which username, which league. That keeps the schema ignorant of
-- the route vocabulary, so a seventh tool is a new line in a pure helper rather
-- than a migration; and it is what the source this was ported from does. The
-- one fact that cannot be derived from a path is `viewer`, which is why that is
-- the only other column.
CREATE TABLE IF NOT EXISTS visitor_logs (
    -- **This repo's first synthetic key**, and it earns one where the other ten
    -- tables have natural keys: a visit has no identity of its own — the same
    -- address may hit the same route twice in a millisecond, and those are two
    -- facts rather than one. The read is capped, and a cap over `seen_at` alone
    -- splits a tie arbitrarily, so `(seen_at DESC, id DESC)` is what makes the
    -- ordering total and the cap reproducible.
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- When the request arrived, stamped by the database. `seen_at` rather than
    -- the house's `created_at` because here the timestamp is not a row's
    -- lifecycle, it is the observation itself.
    seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- **Nullable, deliberately, and this is the one column worth reading the
    -- comment for.** The source this was ported from declares it `INET NOT NULL`
    -- and writes the literal strings "Unknown IP" / "Invalid IP" into it when a
    -- request carries no usable `x-forwarded-for`. Neither casts to `INET`, so
    -- Postgres raises, and the insert is fire-and-forget, so the row is dropped
    -- with nothing said — which is why that app has never logged a single local
    -- visit, where there is no such header at all. Null is the honest value: an
    -- address we do not have is absent, not a sentinel, and absent is not zero.
    ip INET,
    -- The pathname, as the proxy saw it. Query strings are not kept: they carry
    -- the logs token itself on one route and nothing anybody reads on the rest.
    route TEXT NOT NULL,
    -- **Who was looking**, from the account cookie — as opposed to who was being
    -- looked *at*, which is in `route`. They are two different questions and one
    -- column could not answer both: `/manager/jkap86` opened by somebody else
    -- names two people, and collapsing them would attribute every visit to its
    -- subject. Null when no account has been resolved on that browser yet.
    viewer VARCHAR(255)
);

-- The window predicate and the newest-first ordering are one read, so they are
-- one index. Rows are kept rather than pruned, so this is what stops the page
-- from full-scanning a table that only grows — the ported original has no index
-- at all.
CREATE INDEX IF NOT EXISTS visitor_logs_seen_idx
    ON visitor_logs (seen_at DESC, id DESC);

-- Down Migration
DROP INDEX IF EXISTS visitor_logs_seen_idx;
DROP TABLE IF EXISTS visitor_logs;
