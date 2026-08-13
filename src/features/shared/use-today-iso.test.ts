import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { todayIso } from "./date-range.ts";
import {
  MIDNIGHT_SETTLE_MS,
  type TodayWatchHost,
  useTodayIso,
  watchToday,
} from "./use-today-iso.ts";

/**
 * The date a relative ADP window is resolved against, kept current.
 *
 * What is under test is the loop rather than the hook: the clock, the timer and
 * the visibility subscription arrive as a host, which is the split `dialog-open`
 * and `pointer` already keep — the calls need a browser, the decisions around
 * them do not, and the decisions are the half with somewhere to be wrong. The
 * hook's own contribution is three lines of wiring and its seed, and the seed is
 * asserted below through a static render.
 *
 * The failure all of it guards: a tab opened on the 13th and left overnight went
 * on asking for a window ending on the 13th, because nothing re-renders a page
 * for the calendar turning over.
 */

/** A clock, a single timer and a visibility subscription, all driven by hand. */
function harness(start: Date) {
  let clock = start;
  let pending: { at: number; fire: () => void } | null = null;
  let visible: (() => void) | null = null;
  const published: string[] = [];
  const counts = { scheduled: 0, cancelled: 0, unsubscribed: 0 };

  const host: TodayWatchHost = {
    now: () => new Date(clock),
    schedule(fire, ms) {
      counts.scheduled += 1;
      const timer = { at: clock.getTime() + ms, fire };
      pending = timer;
      return () => {
        counts.cancelled += 1;
        // By identity, so a cancel arriving after the timer has been replaced
        // cannot retire its successor.
        if (pending === timer) pending = null;
      };
    },
    onVisible(check) {
      visible = check;
      return () => {
        counts.unsubscribed += 1;
        visible = null;
      };
    },
  };

  return {
    host,
    published,
    counts,
    /** What the watch is waiting for, or null if it is waiting for nothing. */
    pendingAt: () => (pending === null ? null : new Date(pending.at)),
    /** Move the clock, firing whatever the watch had scheduled along the way. */
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
      for (let fired = 0; pending !== null && pending.at <= clock.getTime(); ) {
        assert.ok(++fired < 10, "the watch armed a timer in the past");
        const due = pending;
        pending = null;
        due.fire();
      }
    },
    /**
     * Move the clock *without* firing anything: a backgrounded tab whose timers
     * were throttled or frozen outright.
     */
    suspend(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    /** The tab coming back into view. */
    wake: () => visible?.(),
    /** The publisher, so a call can be counted. */
    publish: (today: string) => void published.push(today),
  };
}

/** 09:00 on the 13th, local — the tab being opened. */
const OPENED = new Date(2026, 7, 13, 9, 0, 0);
/** Midnight ending that day, plus the settle. */
const FIRST_MIDNIGHT = new Date(2026, 7, 14, 0, 0, 0, MIDNIGHT_SETTLE_MS);

describe("watchToday", () => {
  test("publishes the day it starts on, then waits for the next one", () => {
    const h = harness(OPENED);
    watchToday(h.publish, h.host);

    // The seed is what closes the gap between a render and the effect that
    // follows it — a gap midnight can fall inside. In the ordinary case it is
    // the value the caller already holds, which a React setter bails out of.
    assert.deepEqual(h.published, ["2026-08-13"]);
    assert.equal(h.counts.scheduled, 1, "one timer, not a poll");
    assert.deepEqual(h.pendingAt(), FIRST_MIDNIGHT);
  });

  test("the day rolls at midnight, and the next wait is armed from there", () => {
    const h = harness(OPENED);
    watchToday(h.publish, h.host);

    h.advance(FIRST_MIDNIGHT.getTime() - OPENED.getTime() - 1);
    assert.deepEqual(h.published, ["2026-08-13"], "a second short of it");

    h.advance(1);
    assert.deepEqual(h.published, ["2026-08-13", "2026-08-14"]);
    assert.equal(h.counts.scheduled, 2);
    assert.deepEqual(
      h.pendingAt(),
      new Date(2026, 7, 15, 0, 0, 0, MIDNIGHT_SETTLE_MS),
    );
  });

  test("nothing is published between midnights, however often it is checked", () => {
    // The whole cost of this mid-day: none. A check that finds the same date
    // publishes nothing, so no memo is invalidated and no board is re-requested
    // for a window that has not moved.
    const h = harness(OPENED);
    watchToday(h.publish, h.host);
    h.advance(60_000);
    h.wake();
    h.suspend(3_600_000);
    h.wake();
    assert.deepEqual(h.published, ["2026-08-13"]);
  });

  test("a tab suspended past midnight catches up in one step", () => {
    // A frozen tab's timer arrives late — hours or days late — and what it must
    // not do is publish the day it slept through and then arm for a midnight
    // already in the past. Re-arming reads the clock rather than adding a day,
    // so waking on the 16th is one correct step.
    const h = harness(OPENED);
    watchToday(h.publish, h.host);

    h.advance(3 * 86_400_000 + 3_600_000);
    assert.deepEqual(h.published, ["2026-08-13", "2026-08-16"]);
    assert.equal(h.counts.scheduled, 2, "and it did not fire once per day slept");
    assert.deepEqual(
      h.pendingAt(),
      new Date(2026, 7, 17, 0, 0, 0, MIDNIGHT_SETTLE_MS),
    );
  });

  test("coming back into view refreshes a tab whose timer never fired", () => {
    // The case the timer alone cannot answer: a backgrounded tab may have its
    // timers throttled indefinitely, so the date is re-read on the way back in.
    const h = harness(OPENED);
    watchToday(h.publish, h.host);

    h.suspend(20 * 3_600_000);
    assert.deepEqual(h.published, ["2026-08-13"], "the timer is still pending");

    h.wake();
    assert.deepEqual(h.published, ["2026-08-13", "2026-08-14"]);
    // And the stale timer is replaced rather than left to fire beside its
    // successor — every path arms through one cancel-then-schedule.
    assert.equal(h.counts.cancelled, 1);
    assert.deepEqual(
      h.pendingAt(),
      new Date(2026, 7, 15, 0, 0, 0, MIDNIGHT_SETTLE_MS),
    );
  });

  test("the teardown takes the timer and the listener with it", () => {
    const h = harness(OPENED);
    const stop = watchToday(h.publish, h.host);

    stop();
    assert.equal(h.counts.cancelled, 1);
    assert.equal(h.counts.unsubscribed, 1);
    assert.equal(h.pendingAt(), null);

    // Nothing left to fire, and nothing left listening.
    h.advance(7 * 86_400_000);
    h.wake();
    assert.deepEqual(h.published, ["2026-08-13"]);
  });

  test("a host with no visibility to watch is still a watch", () => {
    // The server has no document, so the subscription is optional and its
    // absence must not cost the timer.
    const h = harness(OPENED);
    const stop = watchToday(h.publish, { now: h.host.now, schedule: h.host.schedule });
    h.advance(FIRST_MIDNIGHT.getTime() - OPENED.getTime());
    assert.deepEqual(h.published, ["2026-08-13", "2026-08-14"]);
    stop();
    assert.equal(h.pendingAt(), null);
  });
});

describe("useTodayIso", () => {
  test("opens on today, exactly as the call sites computed it before", () => {
    // A static render, so no effect runs: what is asserted is the seed, which is
    // the value a server render and the first client render both produce. The
    // hook can only ever *correct* it afterwards.
    function Probe() {
      return createElement("span", null, useTodayIso());
    }
    assert.equal(
      renderToStaticMarkup(createElement(Probe)),
      `<span>${todayIso()}</span>`,
    );
  });
});
