"use client";

// With the `.ts`, unlike `ktc-board.ts` and like `shares-columns.ts`: this
// module is tested under Node's own runner, which resolves the file it is given
// rather than the alias graph — the same reason those two differ from each
// other today.
import { useLocalValue, writeLocal } from "./local-store.ts";

/**
 * When this device last saw a sync land, so the trades board can stop trusting
 * what a browser cached before it.
 *
 * **The problem is HTTP caching, not the server's own.** `/api/trades` answers
 * `private, max-age=30` and `/api/trades/leagues` `private, max-age=300`, and
 * both are right for ordinary browsing: the board moves at the sync's pace, and
 * which leagues traded this season changes only when a sync writes a league's
 * first trade. What neither header can express is the one moment those
 * assumptions are false — a reader has *just asked for a sync*, watched it
 * finish, and walked to `/trades`. There the browser answers from its own cache
 * and the page shows the board as it stood before the thing the reader did.
 *
 * The five-minute one is the worse half, and it is the reason `/api/trades` and
 * `/api/trades/leagues` had to be dealt with together: a sync that imports a
 * league's first trade makes that trade visible on the board while the league
 * selector, the filter counts and the card's own league *name* still come from
 * a payload that had never heard of it.
 *
 * **A stamp in the query string rather than a header change**, which is the
 * "query-key version bump" of the options available and the only one that
 * survives a navigation. Turning the caching off would spend the whole benefit
 * of it — every scroll, every filter press and every back button, on every
 * reader — to fix the seconds after a sync. Here the URL is simply a different
 * URL once, the browser has nothing cached under it, and the next request is
 * back on the ordinary key.
 *
 * It is a *device* fact, so it lives on `local-store` with the account and the
 * value basis — and it crosses tabs for free, because that store's `storage`
 * listener is what makes a sync in one tab reach the board open in another.
 *
 * **The server needs none of this.** Its own in-process caches are dropped at
 * the commit by `shared/trades/invalidate`, which is the authoritative half;
 * this is only about what a browser is holding. A stamp from a device that
 * never synced anything is simply absent, and every request is the plain one.
 */

const STORAGE_KEY = "thelab:trades-synced-at";

/**
 * The most recent stamp, or the empty string where nothing has been synced on
 * this device.
 *
 * Empty rather than null so it can be concatenated into a query key without a
 * branch, and so a reader who has never synced sends the exact URL they always
 * did — which is what keeps the cache doing its job for the common case.
 */
export type TradeDataStamp = string;

/** Nothing has been synced on this device — the plain, cacheable request. */
export const NO_TRADE_STAMP: TradeDataStamp = "";

/**
 * Fold a stored value into a usable stamp.
 *
 * Digits only, and capped in length, because it goes into a URL: the store is
 * `localStorage`, which anything on the origin can write, and a stamp is a
 * cache-busting token rather than an instruction. Anything else reads as "never
 * synced", which is the safe fold — a bad stamp costs a reader the refresh they
 * asked for, where an unvalidated one would put arbitrary text on a request
 * line.
 */
export function parseTradeDataStamp(
  value: string | null | undefined,
): TradeDataStamp {
  if (typeof value !== "string") return NO_TRADE_STAMP;
  return /^[0-9]{1,16}$/.test(value) ? value : NO_TRADE_STAMP;
}

/**
 * Record that a sync has just written data the trades board reads.
 *
 * Called from the two places a reader can cause one: the lineup checker's
 * per-league `Sync` key, and the manager page's own leagues stream once a
 * refresh it was watching closes. Both mark only on a sync that **landed** —
 * a cooldown, a refusal or a failure has changed nothing, and busting a cache
 * for one would throw away the reader's own board to re-fetch what it already
 * held.
 *
 * `Date.now()` rather than a counter: the value's only job is to differ from
 * the last one, and a clock does that without needing to be read first.
 */
export function markTradeDataSynced(): void {
  writeLocal(STORAGE_KEY, String(Date.now()));
}

/**
 * The stamp this device's trade requests should carry.
 *
 * Null on the server and on the first client render, which `local-store`
 * documents and which is right here: the first render's request is the plain
 * cacheable one, and a stored stamp swaps in after hydration — one extra fetch,
 * once, for a reader who has synced. No `useMemo`, because the value is a
 * string and `useSyncExternalStore` already compares by identity.
 */
export function useTradeDataStamp(): TradeDataStamp {
  return parseTradeDataStamp(useLocalValue(STORAGE_KEY));
}
