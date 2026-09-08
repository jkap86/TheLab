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
