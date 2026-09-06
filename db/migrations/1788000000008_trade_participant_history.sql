-- Up Migration
-- Historical trade attribution: who was in a trade *then*, kept apart from who
-- holds that roster *now*.
--
-- ## The bug this closes
--
-- `trade_participants` carried one owner column, derived from `rosters.owner_id`
-- as it stands at the moment of the rebuild — and `writeLeagueGraph` rebuilds
-- the whole league's rows on every sync. So a roster changing hands rewrote the
-- attribution of every trade that roster had ever been in: manager A's trades
-- from October became manager B's the first time B's ownership synced. That is
-- not a stale answer, it is a *wrong* one, and it is wrong in the four places
-- that read this table — the leaguemates circle, the managers facet, the bay
-- filter and the name on a card's side.
--
-- ## What the two columns mean
--
--   * `owner_id` — the roster's owner **now**. Still maintained on every sync,
--     still what a reader wants when they ask "whose team is that today".
--     Nullable from here on, because a roster can be orphaned after a trade was
--     recorded and "nobody holds it today" is a real answer; the historical row
--     stays regardless.
--   * `owner_id_at_trade` — who held the roster when this app **first observed**
--     the trade. Written once, on the row's first insert, and never touched
--     again: the rebuild's `ON CONFLICT` clause names neither this column nor
--     the provenance beside it, so there is no branch for a later edit to
--     flatten. `NOT NULL`, because a row is only created when somebody can be
--     named — an orphan roster contributes nothing, exactly as it did before.
--
-- ## What `owner_provenance` is honest about
--
-- **Sleeper publishes no ownership history.** There is no endpoint that answers
-- "who held roster 4 in October", so `owner_id_at_trade` is not a recovered
-- fact; it is the best evidence available at the moment the trade entered this
-- database, and how good that is depends entirely on how soon after the trade
-- that was. Two values say which:
--
--   * `'ingest'` — captured from the roster's owner when the sync that first
--     stored this trade ran. For a league synced regularly this is the
--     trade-time owner; for a league first synced years later it is whoever held
--     the roster on that day.
--   * `'backfill'` — set by this migration, for every row already in the table.
--     These carry today's owner because that is the only thing that was ever
--     stored, and they are marked so that nothing downstream mistakes them for
--     an observation.
--
-- The point of the column is not to filter on it — no read does — but so that a
-- future reader can tell how much weight the attribution carries, and so that
-- a later backfill from a better source has something to overwrite selectively.

ALTER TABLE trade_participants
    ADD COLUMN IF NOT EXISTS owner_id_at_trade VARCHAR(255),
    ADD COLUMN IF NOT EXISTS owner_provenance VARCHAR(16) NOT NULL DEFAULT 'ingest',
    -- When the row was first written, which is the only date attached to the
    -- snapshot above and therefore the only way to judge it. `now()` for the
    -- backfilled rows is a lie of the same size as the attribution they carry,
    -- which `owner_provenance` is what actually flags.
    ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Every row that already exists gets today's owner as its snapshot, marked for
-- what it is. This is not a guess dressed up as data: it is exactly what the
-- table already claimed, now labelled so the claim can be judged.
UPDATE trade_participants
   SET owner_id_at_trade = owner_id,
       owner_provenance = 'backfill'
 WHERE owner_id_at_trade IS NULL;

-- Safe now that the backfill above has run, and it is what lets every read take
-- this column without a `coalesce`.
ALTER TABLE trade_participants
    ALTER COLUMN owner_id_at_trade SET NOT NULL;

-- **`owner_id` becomes nullable, and that is a consequence of the snapshot
-- being immutable.** A row is kept for as long as the trade names the roster;
-- if that roster is later orphaned there is no current owner to write, and the
-- alternatives are both worse — deleting the row throws the history away, and
-- leaving the last known owner in a column named "now" is the same wrong claim
-- this migration exists to stop making.
ALTER TABLE trade_participants
    ALTER COLUMN owner_id DROP NOT NULL;

-- The historical read from the manager side: every trade a set of managers was
-- *in at the time*. This is `trade_participants_owner_idx`'s counterpart, and
-- it is the index the leaguemates circle and the managers facet now drive from
-- — those are the reads with no `ORDER BY` and no `LIMIT`, so the planner is
-- free to start from the manager, and it needs somewhere to start.
CREATE INDEX IF NOT EXISTS trade_participants_at_trade_idx
    ON trade_participants (owner_id_at_trade, transaction_id);

-- The correlated read's covering index.
--
-- The primary key is `(transaction_id, roster_id) INCLUDE (owner_id)`, and an
-- `INCLUDE` list cannot be altered — so the bay filter, which arrives holding a
-- transaction and a roster and asks who held it *then*, would take a heap fetch
-- per candidate trade without this. That is precisely the cost
-- `rosters_league_roster_owner_idx` was added to remove from the same question
-- one column over.
CREATE INDEX IF NOT EXISTS trade_participants_trade_roster_at_trade_idx
    ON trade_participants (transaction_id, roster_id) INCLUDE (owner_id_at_trade);

-- New columns and a new distribution; the planner should not be guessing about
-- either. Same reasoning as the `ANALYZE` the creating migration ends on.
ANALYZE trade_participants;

-- Down Migration
DROP INDEX IF EXISTS trade_participants_trade_roster_at_trade_idx;
DROP INDEX IF EXISTS trade_participants_at_trade_idx;

-- A row whose roster is orphaned has no current owner to restore, and the
-- column it is going back to is `NOT NULL` — so those rows go. They are
-- re-derived by the next sync of their league (minus the history, which is what
-- going down costs), and leaving them would fail the constraint outright.
DELETE FROM trade_participants WHERE owner_id IS NULL;
ALTER TABLE trade_participants ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE trade_participants
    DROP COLUMN IF EXISTS first_seen_at,
    DROP COLUMN IF EXISTS owner_provenance,
    DROP COLUMN IF EXISTS owner_id_at_trade;
