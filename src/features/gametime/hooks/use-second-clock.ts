"use client";

import { useSyncExternalStore } from "react";

/**
 * The wall clock to the second, for the one thing on the gametime page that
 * ticks: the waiting pill's countdown to the next kickoff.
 *
 * **An external store rather than a `useState` and an interval**, for three
 * reasons. It is one timer however many readers there are, and none at all
 * while nothing is counting — the countdown is the only subscriber and it is
 * mounted only while there is a kickoff to count to. It gives the server and
 * the hydration render a `null` of their own rather than a `Date.now()` that
 * would differ between the two passes. And the value is read in the leaf that
 * prints it, so a tick re-renders a pill and not a page of a hundred cards.
 *
 * **Aligned to the next second boundary, never `setInterval(1000)`**, which
 * drifts against the wall clock and every so often lands two ticks in one
 * second and none in the next — a countdown that goes `0:12`, `0:10` is the one
 * glitch a ticking readout cannot have. The few milliseconds past the boundary
 * are what guarantee `Date.now()` has crossed into the new second when the
 * timer fires.
 *
 * **A hidden tab throttles it to about once a minute, and that is fine here**,
 * which is the reverse of the call `LeagueSyncKey` makes about a cooldown
 * countdown. That one would re-enable a key the server still refuses; this is
 * a reading of an absolute instant the scoreboard published, so a throttled
 * tick is merely a late one, and the first tick after the tab is shown again
 * is correct.
 */

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * The current second, floored — so every read inside one second agrees, which
 * is what `useSyncExternalStore` asks of a snapshot. Two reads straddling a
 * boundary differ, and that costs one extra render rather than a torn one.
 */
const snapshot = (): number => Math.floor(Date.now() / 1000) * 1000;

const serverSnapshot = (): null => null;

function schedule() {
  timer = setTimeout(
    () => {
      for (const listener of listeners) listener();
      schedule();
    },
    1000 - (Date.now() % 1000) + 8,
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) schedule();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** Epoch ms floored to the second, or null on the server and the hydration render. */
export function useSecondClock(): number | null {
  return useSyncExternalStore<number | null>(subscribe, snapshot, serverSnapshot);
}
