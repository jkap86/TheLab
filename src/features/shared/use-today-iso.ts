"use client";

import { useEffect, useState } from "react";

import { msUntilNextLocalMidnight, todayIso } from "./date-range.ts";

/**
 * What day it is where the reader is, kept current while the tab stays open.
 *
 * **A relative window is resolved against a date, and a date read once is a date
 * held forever.** Every ADP read on these pages is built by a `useMemo` over the
 * controls and the scope with `todayIso()` called inside it, which is right about
 * everything except the clock: React does not re-render because the calendar
 * turned over, so a tab opened on the 13th and left overnight went on asking for
 * "the last 30 days" ending on the 13th — until some unrelated dependency changed
 * or the page was reloaded. The board it drew was a day short, and nothing on
 * screen said so.
 *
 * So the date becomes state, with one timer aimed at the next local midnight
 * rather than a poll: the memo takes it as a dependency and re-keys itself the
 * moment the day does. Mid-day it costs nothing at all — the timer fires once,
 * and {@link watchToday} publishes only when the day has actually changed, so
 * nothing re-renders and no request is re-made between midnights.
 *
 * The seed is `todayIso()`, exactly what the call sites computed during render
 * before this existed, so a server render and the first client render are
 * unchanged and this can only ever *correct* the value afterwards.
 */
export function useTodayIso(): string {
  const [today, setToday] = useState(() => todayIso());

  useEffect(
    () =>
      watchToday(setToday, {
        now: () => new Date(),
        schedule: (fire, ms) => {
          const timer = setTimeout(fire, ms);
          return () => clearTimeout(timer);
        },
        // A backgrounded tab has its timers throttled or suspended outright, so
        // the midnight one can arrive minutes or hours late — or, on a phone
        // whose page was frozen, only once somebody looks at it again. Coming
        // back into view is therefore its own reason to re-read the clock.
        onVisible:
          typeof document === "undefined"
            ? undefined
            : (check) => {
                const onVisibilityChange = () => {
                  if (document.visibilityState === "visible") check();
                };
                document.addEventListener(
                  "visibilitychange",
                  onVisibilityChange,
                );
                return () =>
                  document.removeEventListener(
                    "visibilitychange",
                    onVisibilityChange,
                  );
              },
      }),
    [],
  );

  return today;
}

/**
 * The clock, the timer and the way back into view — everything {@link watchToday}
 * needs from a browser, so that what it *decides* can be driven without one.
 *
 * The same split `dialog-open` and `pointer` keep: the call is unreachable
 * outside a document, the loop around it is not, and the loop is the half with
 * somewhere to be wrong.
 */
export type TodayWatchHost = {
  /** Read the clock. */
  now: () => Date;
  /** Run `fire` in `ms`; the returned function cancels it. */
  schedule: (fire: () => void, ms: number) => () => void;
  /**
   * Subscribe to the document becoming visible again, returning an unsubscribe.
   * Optional, since there is nothing to subscribe to on the server.
   */
  onVisible?: (check: () => void) => () => void;
};

/**
 * A second past midnight, because a timer may fire a hair early.
 *
 * Landing on the boundary itself would read the day *before* the one being
 * waited for and re-arm for the few milliseconds that were left, which is a
 * correct answer arrived at twice. The wait is a day long; a second on the end
 * of it is not a delay anybody can see.
 */
export const MIDNIGHT_SETTLE_MS = 1_000;

/**
 * Watch the local day, publishing it whenever it changes. Returns the teardown.
 *
 * Three rules, and each is a way the obvious version is wrong:
 *
 * - **It publishes only on a change**, seeded by an immediate check. The seed is
 *   what closes the gap between a render and the effect that follows it — a gap
 *   midnight can fall inside — and publishing nothing thereafter until the day
 *   turns is what keeps a wake-up from re-rendering a page for the date it
 *   already had.
 * - **It re-arms from the clock rather than by adding a day.** A timer that fires
 *   late — a suspended tab, a throttled background one — must aim at the *next*
 *   midnight from where it actually woke up, not at the one it has already slept
 *   through. Reading the clock is what makes waking up two days later a single
 *   correct step rather than a queue of missed ones.
 * - **One timer at a time.** Every path arms through the same cancel-then-schedule,
 *   so a visibility wake mid-wait replaces the pending timer instead of leaving a
 *   second one behind it.
 */
export function watchToday(
  publish: (today: string) => void,
  host: TodayWatchHost,
): () => void {
  let cancel: (() => void) | null = null;
  let published: string | null = null;

  function arm() {
    cancel?.();
    cancel = host.schedule(
      check,
      msUntilNextLocalMidnight(host.now()) + MIDNIGHT_SETTLE_MS,
    );
  }

  function check() {
    const today = todayIso(host.now());
    if (today !== published) {
      published = today;
      publish(today);
    }
    arm();
  }

  check();
  const unsubscribe = host.onVisible?.(check);

  return () => {
    cancel?.();
    cancel = null;
    unsubscribe?.();
  };
}
