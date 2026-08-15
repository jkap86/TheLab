"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { hasFinePointer } from "./pointer";
import { prefetchLeagueCore } from "./use-league-detail";

/**
 * How long a pointer has to rest on a card before it counts as intent.
 *
 * A reader sweeping down a hundred-league list crosses every card in it, and one
 * request per crossing is a network storm dressed up as an optimisation. 120ms
 * is comfortably under the time it takes to move a hand to a card and press it —
 * so a deliberate hover still lands the request before the click — and
 * comfortably over the few milliseconds a passing pointer spends on each row.
 */
export const PREFETCH_DELAY_MS = 120;

/**
 * Warm a league's **core** read when a reader shows they are about to open it.
 *
 * Three things bound it, and each closes a way of turning a hint into a cost:
 *
 * - **Core only.** The prices, the outlook and the week are the expensive reads;
 *   speculatively running a lineup solve per team per week for every card a
 *   pointer passes over would spend far more than the hover could ever save. See
 *   {@link prefetchLeagueCore}.
 * - **Fine pointers only.** `pointerenter` fires on a touch too, so without this
 *   a tap would prefetch and then immediately fetch — the request twice, on the
 *   connection least able to afford it. A finger has no hover to read intent
 *   from, so there is nothing here for it to gain. Keyboard focus is exempt:
 *   focus is a deliberate act on any device, and a reader tabbing to a card is
 *   about to press it.
 * - **Debounced, and cancelled on leave.** A crossing that ends before the delay
 *   costs nothing at all.
 *
 * `prefetchQuery` is itself a no-op against an entry inside its stale time, so
 * hovering the same card repeatedly costs one request rather than one per
 * hover, and the press that follows finds the answer already in the cache.
 */
export function useLeaguePrefetch(leagueId: string): {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
} {
  const client = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A card can unmount mid-hover — a filter change, a list re-rendering — and a
  // timer left running would fire a request for a league nobody is looking at.
  useEffect(() => cancel, [cancel]);

  const onPointerEnter = useCallback(() => {
    if (!hasFinePointer(globalThis.window?.matchMedia?.bind(window))) return;
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      prefetchLeagueCore(client, leagueId);
    }, PREFETCH_DELAY_MS);
  }, [cancel, client, leagueId]);

  // Immediate rather than debounced: focus is already a deliberate act, and
  // there is no equivalent of a pointer sweeping across the list.
  const onFocus = useCallback(() => {
    prefetchLeagueCore(client, leagueId);
  }, [client, leagueId]);

  return { onPointerEnter, onPointerLeave: cancel, onFocus };
}
