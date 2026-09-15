import type { SleeperNflState } from "./types/sleeper.types";

/**
 * How long one `state/nfl` answer serves every caller in the process.
 *
 * A minute: the answer moves once a week (the week) and once a year (the
 * season), and what this bounds is the burst — five routes read it per request
 * and three loops per tick, so a page load was several identical round trips
 * to Sleeper for one line of JSON. `shared/season` keeps its own six-hour
 * stale-while-revalidate on top; this only collapses the burst underneath it.
 */
export const NFL_STATE_TTL_MS = 60 * 1000;

export type NflStateFetch = () => Promise<SleeperNflState | null>;

export type NflStateMemoOptions = {
  ttlMs?: number;
  now?: () => number;
};

/**
 * The state fetch, memoized: the **promise** is cached, so concurrent callers
 * share one in-flight request, and a resolved `null` — Sleeper's own fold of a
 * missing body — is held for the TTL like any other answer, because "nothing"
 * is as true for a minute as a state is.
 *
 * A rejection is evicted rather than remembered — the `memoize-manager-lookup`
 * rule — and only our own entry is dropped, since a newer fetch may already be
 * underway. Pure, with the fetch and the clock as arguments, so the TTL, the
 * sharing and the eviction test without a network or a timer.
 */
export function memoizeNflState(
  fetch: NflStateFetch,
  options: NflStateMemoOptions = {},
): NflStateFetch & { clear: () => void } {
  const { ttlMs = NFL_STATE_TTL_MS, now = Date.now } = options;
  let entry: { at: number; value: Promise<SleeperNflState | null> } | null =
    null;

  const memoized = (): Promise<SleeperNflState | null> => {
    if (entry && now() - entry.at < ttlMs) return entry.value;

    const own = { at: now(), value: fetch() };
    entry = own;
    void own.value.catch(() => {
      if (entry === own) entry = null;
    });
    return own.value;
  };

  memoized.clear = () => {
    entry = null;
  };
  return memoized;
}

/**
 * The read, holding on to the last state this process actually read.
 *
 * **A week the app cannot read must not become week 1**, and until this existed
 * it did. `projections/weeks`' `currentWeek` catches a failed state read and
 * answers 1 — the widest honest window, which is exactly right in the abstract
 * and indistinguishable from the truth for one week a year. From week 2 on, a
 * Sleeper outage, a shed permit or a spent request budget renders as a page
 * confidently headed `Week 1`, with nothing in the payload, the log or the UI
 * able to say the number was invented. It is the same class of claim a
 * `DEFAULT now()` on a row nothing has read makes, and the same reason
 * `parseRequestedWeek` refuses to fold an invalid week into the current one.
 *
 * The season already had the answer: `shared/season` serves the last value it
 * resolved through an outage and only then reaches for the compiled-in
 * constant, on the rule that a *stale* answer beats none. The week had no such
 * ladder — it fell from Sleeper straight to a literal — and that asymmetry is
 * the whole of the bug. So the same ladder, one rung: what Sleeper says now,
 * else what it last said, else nothing (and *then* the caller's fallback).
 *
 * **A stale state is served indefinitely**, which is the season resolver's own
 * trade and made for its reason: a TTL says when to try again, not when to stop
 * trusting what we have. A week changes once a week, so the freeze this can
 * cause is bounded by how long Sleeper is down, and every alternative to it is
 * a number nobody measured.
 *
 * **A null body counts as a failure here, not an answer.** `sleeperGet` folds a
 * missing body to the caller's fallback, so `state/nfl` answering nothing and
 * `state/nfl` being unreachable arrive spelled identically — and neither is
 * Sleeper telling us the season has no state, which it spells with a real
 * object whose `week` is 0. Where we hold a good one, that is the better answer.
 *
 * Pure, with the read as an argument, so the ladder tests without a network:
 * it wraps whatever `state.ts` composes — the memo *and* the bounded wait —
 * rather than sitting inside the memo, because a wait shed by the reader's own
 * budget is one of the three failures this exists to catch.
 */
export function holdLastGood(
  read: NflStateFetch,
): NflStateFetch & { lastGood: () => SleeperNflState | null } {
  let held: SleeperNflState | null = null;

  const holding = async (): Promise<SleeperNflState | null> => {
    try {
      const state = await read();
      if (state) {
        held = state;
        return state;
      }
      return held;
    } catch (error) {
      if (held) return held;
      // Nothing to fall back to: a cold process whose first read failed has no
      // week, and saying so is what lets the caller answer honestly rather than
      // inheriting a stale claim it never made.
      throw error;
    }
  };

  holding.lastGood = () => held;
  return holding;
}
