"use client";

import { useState } from "react";

import type { Trade } from "@/shared/trades";

import { advanceFiltered, EMPTY_FILTERED } from "../incremental";
import type { FilteredTrades } from "../incremental";

/**
 * {@link advanceFiltered} held across renders — the two filter passes over a
 * season that arrives in fifty pieces, each piece costing only itself.
 *
 * **The accumulator is `useState` adjusted during render, not a ref**, and the
 * distinction is worth stating because a ref is the first thing this looks like
 * it wants. A ref written during render is a value React does not know changed,
 * so a concurrent render that is thrown away still leaves it written — the
 * lint rule that forbids it is right, and the pattern it points at works here
 * without a caveat. React re-runs a component that sets its own state during
 * render *before committing anything*, so the second pass is this function body
 * and nothing under it: no child renders, no DOM, no effects. And the second
 * pass is free by construction, since `advanceFiltered` given a state that has
 * already judged the whole list returns it unchanged, which is what makes the
 * adjustment terminate.
 *
 * `generation` is the caller's statement that the predicates still mean what
 * they meant last render — see {@link advanceFiltered}, which explains what has
 * to be in it. It is a string so that the check is one comparison rather than a
 * dependency array whose contents are all objects rebuilt every render.
 */
export function useFilteredTrades(
  trades: readonly Trade[],
  generation: string,
  inLeague: (trade: Trade) => boolean,
  matches: (trade: Trade) => boolean,
): FilteredTrades {
  const [cache, setCache] = useState<FilteredTrades>(EMPTY_FILTERED);

  const next = advanceFiltered(cache, trades, generation, inLeague, matches);
  if (next !== cache) setCache(next);

  // `next` rather than `cache`: on the pass that computed it they are different,
  // and rendering the state React has not caught up to yet is the whole point of
  // the pattern — the alternative is a frame of stale list on every chunk.
  return next;
}
