import { useCallback, useSyncExternalStore } from "react";

/**
 * The clock behind the countdown, as an external store — which a wall clock
 * is (`useSyncExternalStore`, the account store's shape). The snapshot is the
 * current *whole second*: it has to be stable within a render or reading it
 * would loop, and a countdown has no use for the milliseconds anyway. The
 * server snapshot is null — there is no "now" the two sides agree on, the
 * account store's hydration rule applied to a clock — so the timer appears
 * only after mount. The subscription starts nothing once `until` has passed,
 * and the interval retires itself when it does, so a header left open across
 * kickoff stops re-rendering a hidden timer.
 */
export function useTick(until: number | null): number | null {
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (until === null || Date.now() >= until) return () => {};
      const id = setInterval(() => {
        onTick();
        if (Date.now() >= until) clearInterval(id);
      }, 1000);
      return () => clearInterval(id);
    },
    [until],
  );

  return useSyncExternalStore<number | null>(
    subscribe,
    () => Math.floor(Date.now() / 1000) * 1000,
    () => null,
  );
}
