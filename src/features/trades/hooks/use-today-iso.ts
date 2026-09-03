"use client";

import { useEffect, useState } from "react";

/**
 * What day it is where the reader is, kept current while the tab stays open.
 *
 * **A window is resolved against a date, and a date read once is a date held
 * forever.** The board's seek turns a chosen day into an instant bound with
 * `tradeSeekBounds`, and the memo that does it needs today as a *dependency*:
 * React does not re-render because the calendar turned over, so a tab opened on
 * the 13th and left overnight goes on treating the 13th as today — the seek's
 * "no seek means up to the end of today" would then stop a day short, with
 * nothing on screen saying so.
 *
 * One timer aimed at the next local midnight rather than a poll, so mid-day it
 * costs nothing: the timer fires once and only publishes if the day actually
 * changed.
 *
 * A backgrounded tab has its timers throttled or suspended outright, so the
 * midnight one can arrive late — or, on a phone whose page was frozen, only
 * once somebody looks at it again. Coming back into view is therefore its own
 * reason to re-read the clock.
 */
export function useTodayIso(): string {
  const [today, setToday] = useState(todayIso);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const check = () => {
      setToday((current) => {
        const now = todayIso();
        return now === current ? current : now;
      });
      schedule();
    };

    const schedule = () => {
      clearTimeout(timer);
      // A second past midnight rather than exactly on it: a timer that fires a
      // hair early would read the old day and reschedule for ~0ms, spinning.
      timer = setTimeout(check, msUntilNextLocalMidnight() + 1000);
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    function onVisible() {
      if (document.visibilityState === "visible") check();
    }

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return today;
}

/**
 * Today as `YYYY-MM-DD` in the reader's own zone.
 *
 * Built from the local parts rather than `toISOString().slice(0, 10)`, which
 * formats in UTC — for a reader west of Greenwich that is tomorrow's date for
 * the last hours of every evening.
 */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return midnight.getTime() - now.getTime();
}
