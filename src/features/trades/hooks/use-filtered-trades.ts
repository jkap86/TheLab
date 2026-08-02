"use client";

import { useState } from "react";

import type { Trade } from "@/shared/trades";

import { advanceFiltered, EMPTY_FILTERED } from "../incremental";
import type { FilteredTrades, Verdict } from "../incremental";

/**
 * {@link advanceFiltered} held across renders — the residual pass over a board
 * that arrives a page at a time, each page costing only itself.
 *
 * **The accumulator is `useState` adjusted during render, not a ref**, and the
 * distinction is worth stating because a ref is the first thing this looks like
 * it wants. A ref written during render is a value React does not know changed,
 * so a concurrent render that is thrown away still leaves it written — the lint
 * rule that forbids it is right, and the pattern it points at works here without
 * a caveat. React re-runs a component that sets its own state during render
 * *before committing anything*, so the second pass is this function body and
 * nothing under it: no child renders, no DOM, no effects. And the second pass is
 * free by construction, since `advanceFiltered` given a state that has already
 * judged the whole list returns it unchanged, which is what makes the adjustment
 * terminate.
 *
 * The two generations are the caller's statement that the predicate still means
 * what it meant — see {@link advanceFiltered} for what has to be in each, and
 * why they are two rather than one. They are strings so the check is two
 * comparisons rather than a dependency array whose contents are all objects
 * rebuilt every render.
 */
export function useFilteredTrades(
  trades: readonly Trade[],
  generation: string,
  leagueGeneration: string,
  judge: (trade: Trade) => Verdict,
): FilteredTrades {
  const [cache, setCache] = useState<FilteredTrades>(EMPTY_FILTERED);

  const next = advanceFiltered(
    cache,
    trades,
    generation,
    leagueGeneration,
    judge,
  );
  if (next !== cache) setCache(next);

  // `next` rather than `cache`: on the pass that computed it they are different,
  // and rendering the state React has not caught up to yet is the whole point of
  // the pattern — the alternative is a frame of stale list on every page.
  return next;
}
