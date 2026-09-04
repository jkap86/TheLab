-- Up Migration
-- Drop `visitor_logs.viewer`. The column answered "who was looking", and it
-- could not.

-- **What it held was not a viewer, it was the last account this browser looked
-- up.** The cookie behind it was written by `storeAccount`, and the only caller
-- of that is the lookup form on `/tools` — which is also the only way to reach
-- somebody else's manager page, since the Manager card resolves to
-- `/manager/<stored account>`. So looking a second person up rewrote the value,
-- and a reader checking five managers finished the session declaring themselves
-- the fifth. Nothing authenticated it either; the visits before each change
-- were attributed to whoever preceded them.
--
-- A column that names the wrong person is worse than one that names nobody, in
-- exactly the sense this schema refuses a `DEFAULT now()` on a row nothing has
-- ever read: both are claims the data cannot support. So the question goes
-- rather than the answer being patched — a real one needs an identity this app
-- does not have, and `route` still says who each page was *about*, which is the
-- half that was always derivable.
ALTER TABLE visitor_logs DROP COLUMN IF EXISTS viewer;

-- Down Migration
-- The column comes back empty, and it cannot come back otherwise: dropping it
-- discarded every value. That is the honest reversal — a down migration
-- restores the schema, and there is nowhere left to read the data from.
ALTER TABLE visitor_logs ADD COLUMN IF NOT EXISTS viewer VARCHAR(255);
