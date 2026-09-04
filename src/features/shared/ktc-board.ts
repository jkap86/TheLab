"use client";

import type { KtcBoardChoice } from "@/shared/contract";
// Deep-imported rather than taken from `@/shared/ktc`, whose barrel is
// server-only: `board-choice` is pure, which is what makes the rule one
// spelling across two routes and two pages. Same mechanism as `./roster`.
import { parseKtcBoardChoice } from "@/shared/ktc/board-choice";

import { useLocalValue, writeLocal } from "./local-store";

// Which KeepTradeCut market this device reads, remembered across reloads and
// trips between pages. The storage mechanics live in `local-store.ts`; the rule
// the value stands for lives in `@/shared/ktc/board-choice`; what is here is
// only the key and the wrapper, on `account.ts`'s and `lineup-columns.ts`'s
// exact terms.
//
// **One key for both pages that read it.** The manager page and the trades
// board are two views of the same market, so "which board do I read" has one
// answer — the same argument that put the resolved account in `features/shared`
// rather than beside the tools page that writes it. Flipping it on either page
// moves the other.
const STORAGE_KEY = "thelab:ktc-board";

/** Persist the chosen board (normalized, see below) and notify readers. */
export function storeKtcBoard(choice: KtcBoardChoice) {
  writeLocal(STORAGE_KEY, parseKtcBoardChoice(choice));
}

/**
 * The chosen board — `auto` on the server, on the first client render, and
 * wherever nothing valid is stored (the documented `local-store` trade: a
 * stored choice swaps in after hydration).
 *
 * Normalized on read as well as write, so a stale or hand-edited value cannot
 * put the page on a market the control has no state for. No `useMemo`: the
 * value is a string, so `useSyncExternalStore`'s identity comparison already
 * holds and there is nothing parsed to keep stable.
 */
export function useKtcBoard(): KtcBoardChoice {
  return parseKtcBoardChoice(useLocalValue(STORAGE_KEY));
}
