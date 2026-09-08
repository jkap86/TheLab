"use client";

import { createContext, useContext } from "react";

import type { KtcBoardChoice, TradeValueBasis } from "@/shared/contract";

/**
 * The reader's value basis and KeepTradeCut market, as one context provided
 * once by `TradesList` and read where a figure is actually computed.
 *
 * **Why a context and not two props on `TradeCard`.** The card is `memo`'d over
 * a board that appends a hundred rows at a time, and `basis`/`board` used to be
 * two of its props — so a flip of either changed a prop on *every* loaded card,
 * dropped the memo for all of them, and re-rendered whole cards (billet, config
 * window, both hauls, the disclosure hint) to change one figure per asset. Read
 * here instead, a flip re-renders exactly the consumers: the two side columns
 * of each card, which are the only things on a closed card that print a value.
 *
 * **Why this is not the per-card store subscription the props were avoiding.**
 * That rule (see `TradeCard`) is about hundreds of rows each subscribing to
 * `localStorage` through `useSyncExternalStore` — hundreds of listeners on one
 * store, and a store read per card per render. A context read subscribes
 * nothing: the store is still read once, in `TradesHome`, and React fans the
 * value out to consumers only on the render in which it changed. The provider's
 * value is memoised on the two fields for the same reason — a fresh object per
 * list render would re-render every consumer on every appended page.
 */
export type ValueLensChoice = {
  /** Which of the three bases every figure on the board is on — `ValuePanel`. */
  basis: TradeValueBasis;
  /** The reader's KeepTradeCut market choice — see `useKtcBoard`. */
  board: KtcBoardChoice;
};

const ValueLensContext = createContext<ValueLensChoice | null>(null);

export const ValueLensProvider = ValueLensContext.Provider;

/** The choice `TradesList` published. A card rendered outside the list is a bug. */
export function useValueLensChoice(): ValueLensChoice {
  const choice = useContext(ValueLensContext);
  if (choice === null) {
    throw new Error("useValueLensChoice: no ValueLensProvider above this card");
  }
  return choice;
}
