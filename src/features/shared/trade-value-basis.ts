"use client";

import type { TradeValueBasis } from "@/shared/contract";

import { useLocalValue, writeLocal } from "./local-store";

// Which basis the trades board reads every figure on, remembered across reloads
// and trips between pages. The storage mechanics live in `local-store.ts`; what
// is here is the key, the vocabulary and the wrapper, on `account.ts`'s and
// `ktc-board.ts`'s exact terms.
//
// **Its own key rather than a share of `thelab:ktc-board`.** Those are two
// different questions and only one of them is about KeepTradeCut: the board
// choice says *which market* to read, and this says whether a market is what is
// being read at all. A reader on the capital basis still has a board choice,
// and it still means what it meant when they last used it.
const STORAGE_KEY = "thelab:trade-value-basis";

/**
 * In panel order. KeepTradeCut sits in the middle because it is the default and
 * because the two flanking it are the two the app derives itself — a curve fit
 * off drafts, and a projection — where KTC is somebody else's number.
 */
export const TRADE_VALUE_BASES: readonly TradeValueBasis[] = [
  "capital",
  "ktc",
  "ros",
];

/**
 * The default, and it is today's behaviour rather than a preference: every
 * figure on this board was KeepTradeCut before the basis existed, so a reader
 * who never opens the panel sees exactly the board they had.
 */
export const DEFAULT_TRADE_VALUE_BASIS: TradeValueBasis = "ktc";

/**
 * Fold anything — a stored string, a hand-edited value, a basis this build no
 * longer offers — into a valid one.
 *
 * **An unreadable value becomes the default rather than failing**, which is the
 * reading `parseKtcBoardChoice` gives its own input and for the same reason: a
 * basis is a display unit over data already chosen, not a claim about *which*
 * data, so the neutral answer is the one that leaves a stale bookmark readable.
 * The season parameter is the opposite call, for the opposite reason.
 */
export function parseTradeValueBasis(
  value: string | null | undefined,
): TradeValueBasis {
  return TRADE_VALUE_BASES.includes(value as TradeValueBasis)
    ? (value as TradeValueBasis)
    : DEFAULT_TRADE_VALUE_BASIS;
}

/** Persist the chosen basis (normalized, see above) and notify readers. */
export function storeTradeValueBasis(basis: TradeValueBasis) {
  writeLocal(STORAGE_KEY, parseTradeValueBasis(basis));
}

/**
 * The chosen basis — the default on the server, on the first client render, and
 * wherever nothing valid is stored (the documented `local-store` trade: a
 * stored choice swaps in after hydration).
 *
 * Normalized on read as well as write, so a stale value cannot put the board on
 * a basis the panel has no lamp for. No `useMemo`: the value is a string, so
 * `useSyncExternalStore`'s identity comparison already holds.
 */
export function useTradeValueBasis(): TradeValueBasis {
  return parseTradeValueBasis(useLocalValue(STORAGE_KEY));
}
