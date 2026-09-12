"use client";

import { useMemo } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  normalizeLeagueFilters,
  type LeagueFilters,
} from "./league-filters";
import { useLocalValue, writeLocal } from "./local-store";

// Which leagues a reader has narrowed to, remembered on the device. The storage
// mechanics live in `local-store.ts`; the rule that keeps a stored value honest
// lives in `./league-filters/normalize`; what is here is only the two keys and
// the wrapper — `ktc-board.ts`'s shape exactly.
//
// **The selection used to be per-page and per-manager, and both halves of that
// were the same mistake.** A reader who filters to their dynasty leagues on
// `/manager` and walks to `/lineupchecker` is asking the same question of the
// same leagues, and was handed the unfiltered hundred; a reader who comes back
// tomorrow was handed them again. The narrowing is how they read their account
// rather than a property of one visit, so it outlives both.
//
// **Two keys, and the split is which leagues the question is about.** The three
// manager-scoped tools — `/manager`, `/lineupchecker`, `/gametime` — list *one
// account's* leagues, so they share one value on `summary-readings.ts`' own
// terms: three tools over one object, and a narrowing that held on one and not
// the next is the drift the convergence passes removed, one setting deep.
// `/trades` is a different question wearing the same vocabulary. Its leagues are
// every league in the corpus that traded this season rather than anybody's
// account, so "my dynasty leagues" is not a narrowing it can be asked for; and
// its filters *cross the wire* as a league scope, where the other three narrow a
// list already in hand — so one key would let a press on `/manager` silently
// re-page a scrolled keyset walk on a board the reader is not looking at. What
// the two stores share is the mechanism below and nothing else, which is the
// honest statement of the separation.
//
// **Neither key is the manager's.** A selection is a *vocabulary* — dynasty,
// superflex, a trade deadline — and it means the same thing of anybody's
// leagues, so it is not scoped by whose page it is read on: walking from one
// account to another keeps the question and changes the answer. That reverses
// `leagues-home.tsx`'s own render-time reset, which cleared the filters with the
// subjects when the manager changed; the subjects still go, because a player id
// narrows *rosters* and means nothing on the next account.
const STORAGE_KEY = "thelab:league-filters";

const TRADES_STORAGE_KEY = "thelab:trade-league-filters";

/**
 * The stored selection under one key — the neutral selection on the server, on
 * the first client render, and wherever nothing valid is stored (the documented
 * `local-store` trade: a stored choice swaps in after hydration).
 *
 * Parsed in a memo keyed on the raw string, per that store's contract: the
 * snapshot it compares is the string, so a caller that parsed on every read
 * would hand back a fresh object each render and loop.
 *
 * **The one render of defaults costs the three list pages nothing**, because a
 * filter there narrows a list the browser already holds: no request names it,
 * and the leagues have not arrived yet anyway. `/trades` does spend a request on
 * its scope, and it is already gated — `useTrades` waits on
 * `useTradeDataStamp`'s `resolved`, which flips on the same post-hydration
 * render this value lands on, so the first request it makes is the narrowed one.
 */
function useStoredFilters(key: string): LeagueFilters {
  const raw = useLocalValue(key);
  return useMemo(() => {
    if (!raw) return DEFAULT_LEAGUE_FILTERS;
    try {
      return normalizeLeagueFilters(JSON.parse(raw));
    } catch {
      return DEFAULT_LEAGUE_FILTERS;
    }
  }, [raw]);
}

/**
 * Persist the selection the three manager-scoped tools share (normalized, see
 * `./league-filters/normalize`) and notify readers.
 *
 * A module-level function rather than a `useCallback`, on
 * `toggleSummaryReadings`' terms: it is handed straight to the filters dialog as
 * its `onChange` and to the `Clear` key beside it, and a fresh identity per
 * render would republish to a rack that sets an ancestor's state.
 */
export function storeLeagueFilters(filters: LeagueFilters) {
  writeLocal(STORAGE_KEY, JSON.stringify(normalizeLeagueFilters(filters)));
}

/** The selection `/manager`, `/lineupchecker` and `/gametime` read. */
export function useLeagueFilters(): LeagueFilters {
  return useStoredFilters(STORAGE_KEY);
}

/** Persist the trades board's own selection and notify readers. */
export function storeTradeLeagueFilters(filters: LeagueFilters) {
  writeLocal(
    TRADES_STORAGE_KEY,
    JSON.stringify(normalizeLeagueFilters(filters)),
  );
}

/** The selection `/trades` reads — its own, for the reason above. */
export function useTradeLeagueFilters(): LeagueFilters {
  return useStoredFilters(TRADES_STORAGE_KEY);
}
