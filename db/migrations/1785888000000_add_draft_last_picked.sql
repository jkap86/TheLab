-- Up Migration

-- When the draft's most recent pick was made, epoch milliseconds, straight from
-- Sleeper's draft object. On a complete draft this is the instant the draft
-- ended; on one still running it is simply the last pick so far, which is the
-- same question asked of a moving target. Null where Sleeper sent none — a draft
-- nobody has picked in yet, and any draft stored before this column existed.
--
-- It is what bounds "during the startup draft" for the trades board. A league's
-- first draft stocks empty rosters, so every trade before its last pick is a
-- draft-room pick swap rather than a move in the market the board is about, and
-- `getAllTrades` excludes them. Nothing else can supply that bound: `draft_picks`
-- carries no timestamp of its own, and `start_time` opens the window without
-- closing it.
--
-- Null is deliberately inert rather than a guess: a league whose drafts predate
-- this column gets no cutoff and keeps every trade until the crawler re-visits
-- it, which is the honest failure — hiding trades on an invented boundary is not.
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS last_picked BIGINT;

-- Down Migration
ALTER TABLE drafts DROP COLUMN IF EXISTS last_picked;
