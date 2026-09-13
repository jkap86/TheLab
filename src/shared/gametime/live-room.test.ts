import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerWeekLineupRow } from "@/shared/manager";
import type { WeekProjections } from "@/shared/projections";
import type { GametimeStreamMessage, ManagerGametimePayload } from "@/shared/contract";

import type { WeekFeeds } from "./feeds.ts";
import { gametimeRooms, newRoomRegistry } from "./live-room.ts";
import type { RoomDeps, RoomFrame, RoomTimer } from "./live-room.ts";
import {
  FAILURE_INTERVAL_MS,
  FINAL_SETTLE_INTERVAL_MS,
  FINAL_SETTLE_WINDOW_MS,
  KICKOFF_LEAD_MS,
  LINGER_MS,
  LIVE_INTERVAL_MS,
  STALE_AFTER_FAILURES,
  WAITING_INTERVAL_MS,
} from "./live-rules.ts";

/**
 * The room driven end to end — scripted feeds, scripted timers, a scripted
 * clock — so the failures this file exists for are *behaviours* rather than
 * source text: a timer that is never armed again, a frame that never goes
 * out, a poller left ticking a room that has closed.
 */

const NOW = Date.UTC(2026, 8, 13, 20, 0, 0);
const SEASON = "2026";
const WEEK = 1;

type Games = WeekFeeds["games"];
type Statuses = WeekFeeds["statuses"];

const ALL_FINAL: Games = { pre: 0, live: 0, final: 16 };
const HEALTHY: Statuses = { projections: "ok", stats: "ok", scores: "ok" };
const STATS_DOWN: Statuses = { projections: "ok", stats: "error", scores: "ok" };
const SCORES_DOWN: Statuses = { projections: "ok", stats: "ok", scores: "error" };
const BOTH_DOWN: Statuses = { projections: "ok", stats: "error", scores: "error" };

/** One projections board, shared across reads so `feedsMoved` compares it by identity. */
const BOARD = { shared: true } as unknown as WeekProjections;

/** A scripted read of the week: the phases, the health, and a stats stamp. */
function feeds(over: {
  games?: Games;
  statuses?: Statuses;
  stamp?: string;
  nextKickoff?: number | null;
}): WeekFeeds {
  const statuses = over.statuses ?? HEALTHY;
  const stamp = over.stamp ?? "s1";
  return {
    projections: statuses.projections === "ok" ? BOARD : null,
    stats: statuses.stats === "ok" ? ({ stamp } as unknown as WeekProjections) : null,
    clocks: null,
    pricingClocks: null,
    statuses,
    games: over.games ?? ALL_FINAL,
    nextKickoff: over.nextKickoff ?? null,
    signature: `${statuses.stats === "ok" ? stamp : "error"}|clocks`,
    readAt: 0,
  };
}

type Timer = { at: number; run: () => void; cleared: boolean };

/**
 * A room bound to scripted dependencies.
 *
 * `reads` is the queue of answers the feed reader gives, in order; once it is
 * drained the last answer repeats, which is what a quiet feed does. `advance`
 * walks the scripted clock forward, firing every timer that comes due in
 * order and letting each tick's own awaits settle before the next fires —
 * the timers are the room's own chain, so a tick arming the next one inside
 * `advance` is fired by the same call if it falls inside the window.
 */
function harness(reads: WeekFeeds[]) {
  let now = NOW;
  const queue = [...reads];
  let last = queue[0];
  const timers: Timer[] = [];
  const readLog: number[] = [];
  const rows = [{ league_id: "L1" }] as unknown as ManagerWeekLineupRow[];

  const deps: RoomDeps = {
    readFeeds: async () => {
      readLog.push(now);
      const next = queue.shift();
      if (next) last = next;
      return last;
    },
    readRows: async () => rows,
    // The fake solve prints the stats stamp and the statuses into the one
    // league, so a moved feed is a moved league and a delta is observable.
    buildPayload: ({ season, week, leagues, feeds: f }) =>
      ({
        season,
        week,
        projections: f.statuses.projections,
        stats: f.statuses.stats,
        scores: f.statuses.scores,
        read_at: f.readAt,
        games: f.games,
        board: {},
        players: {},
        leagues: Object.fromEntries(
          (leagues as unknown as { league_id: string }[]).map((row) => [
            row.league_id,
            { stamp: f.signature, stats: f.statuses.stats },
          ]),
        ),
      }) as unknown as ManagerGametimePayload,
    now: () => now,
    random: () => 0,
    setTimeout: (run, ms) => {
      const timer: Timer = { at: now + ms, run, cleared: false };
      timers.push(timer);
      return timer as unknown as RoomTimer;
    },
    clearTimeout: (timer) => {
      (timer as unknown as Timer).cleared = true;
    },
    log: { log() {}, warn() {}, error() {} },
  };

  const registry = newRoomRegistry();
  const rooms = gametimeRooms(registry, deps);

  const flush = async () => {
    for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const pending = () => timers.filter((timer) => !timer.cleared);
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = pending()
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cleared = true;
      now = Math.max(now, due.at);
      due.run();
      await flush();
    }
    now = target;
  };

  const frames: GametimeStreamMessage[] = [];
  const listener = (frame: RoomFrame) => {
    frames.push(JSON.parse(frame.json) as GametimeStreamMessage);
    return true;
  };
  const join = async (username = "reader") => {
    const result = await rooms.join(
      { userId: `id-${username}`, username, season: SEASON, week: WEEK },
      listener,
    );
    await flush();
    assert.equal(result.ok, true);
    return result.ok ? result.leave : () => {};
  };

  return {
    deps,
    rooms,
    registry,
    frames,
    readLog,
    pending,
    advance,
    flush,
    join,
    /**
     * The wait on the one tick timer armed, or null where none is. Read only
     * while a reader is seated, so the linger is not among the pending timers
     * — it cannot be told apart by its wait, `LINGER_MS` being the failure
     * cadence to the millisecond.
     */
    nextTickIn: () => {
      const ticks = pending();
      assert.ok(ticks.length <= 1, `one tick timer at most, saw ${ticks.length}`);
      return ticks.length === 0 ? null : ticks[0].at - now;
    },
    now: () => now,
  };
}

const deltas = (frames: GametimeStreamMessage[]) => frames.filter((f) => f.type === "delta");

describe("an all-final scoreboard beside a failed feed keeps the room reading", () => {
  test("stats down on every read: the poller never stops, and never claims to have", async () => {
    const h = harness([feeds({ statuses: STATS_DOWN })]);
    await h.join();
    assert.equal(h.frames[0].type, "payload");
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS);

    // Well past the settle window, still failing on every read.
    await h.advance(3 * FINAL_SETTLE_WINDOW_MS);
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS, "still retrying");
    assert.ok(h.readLog.length > 3 * FINAL_SETTLE_WINDOW_MS / FAILURE_INTERVAL_MS - 2);
    // What the reader holds says so, on every frame: nothing here was
    // presented as a settled week.
    for (const frame of h.frames) {
      if (frame.type === "payload") assert.equal(frame.payload.stats, "error");
      if (frame.type === "delta") assert.equal(frame.delta.stats, "error");
    }
  });

  test("the scoreboard failing is the same fact from the other side", async () => {
    // The cached clocks still read all-final; the read that would price
    // against them did not answer, and a room that stopped here would freeze
    // every player with a stat line at half played.
    const h = harness([feeds({ statuses: SCORES_DOWN })]);
    await h.join();
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS);
    await h.advance(FINAL_SETTLE_WINDOW_MS);
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS);
  });

  test("a room opened on an already-final week with a failed feed recovers", async () => {
    const h = harness([
      feeds({ statuses: STATS_DOWN }),
      feeds({ statuses: HEALTHY, stamp: "final-a" }),
    ]);
    await h.join();
    assert.equal(h.frames.length, 1);

    await h.advance(FAILURE_INTERVAL_MS);
    // The recovered read went out — the statuses moved, so the league moved.
    const [delta] = deltas(h.frames);
    assert.ok(delta && delta.type === "delta");
    assert.equal(delta.delta.stats, "ok");
    assert.deepEqual(Object.keys(delta.delta.leagues), ["L1"]);
    // And the room is now settling, not stopped: one healthy read is not a
    // settled week.
    assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS);
  });

  test("a feed that was down for the whole window cannot settle the room on one answer", async () => {
    const h = harness([feeds({ statuses: STATS_DOWN })]);
    await h.join();
    await h.advance(2 * FINAL_SETTLE_WINDOW_MS);
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS);

    // Recovery, twenty minutes after the games ended.
    h.deps.readFeeds = async () => feeds({ statuses: HEALTHY, stamp: "late" });
    await h.advance(FAILURE_INTERVAL_MS);
    assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS, "the settle window starts now");
    // And runs its whole length from here.
    await h.advance(FINAL_SETTLE_WINDOW_MS - FINAL_SETTLE_INTERVAL_MS);
    assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS);
    await h.advance(FINAL_SETTLE_INTERVAL_MS);
    assert.equal(h.nextTickIn(), null, "settled at the end of a healthy window");
  });

  test("both feeds down: the stale note still fires, and the room still never settles", async () => {
    const h = harness([feeds({ statuses: BOTH_DOWN })]);
    await h.join();
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS);
    await h.advance(STALE_AFTER_FAILURES * FAILURE_INTERVAL_MS);
    assert.equal(h.frames.filter((f) => f.type === "stale").length, 1);
    await h.advance(FINAL_SETTLE_WINDOW_MS);
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS);
    assert.equal(h.frames.filter((f) => f.type === "stale").length, 1, "told once");
  });
});

describe("a healthy final week settles, and only then stops", () => {
  test("stats arriving after the first final scoreboard are delivered", async () => {
    const h = harness([
      feeds({ statuses: HEALTHY, stamp: "first-final" }),
      feeds({ statuses: HEALTHY, stamp: "last-plays-filed" }),
    ]);
    await h.join();
    assert.equal(h.frames.length, 1);
    assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS);

    await h.advance(FINAL_SETTLE_INTERVAL_MS);
    const [delta] = deltas(h.frames);
    assert.ok(delta && delta.type === "delta", "the caught-up stat line reached the reader");
    assert.match(JSON.stringify(delta.delta.leagues.L1), /last-plays-filed/);
  });

  test("the room stops after the window, and not before", async () => {
    const h = harness([feeds({ statuses: HEALTHY, stamp: "final" })]);
    await h.join();
    const opened = h.now();

    // Every read inside the window arms another; the one at the window's end
    // is the last.
    const expectedTicks = FINAL_SETTLE_WINDOW_MS / FINAL_SETTLE_INTERVAL_MS;
    for (let i = 1; i < expectedTicks; i += 1) {
      await h.advance(FINAL_SETTLE_INTERVAL_MS);
      assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS, `still settling after tick ${i}`);
    }
    await h.advance(FINAL_SETTLE_INTERVAL_MS);
    assert.equal(h.now() - opened, FINAL_SETTLE_WINDOW_MS);
    assert.equal(h.nextTickIn(), null, "settled");

    // And it stays stopped: no read is made however long the page stays open.
    const reads = h.readLog.length;
    await h.advance(24 * 60 * 60_000);
    assert.equal(h.readLog.length, reads);
    assert.equal(reads, 1 + expectedTicks);
    assert.equal(h.rooms.stats().weeks, 1, "the room is open, holding the final numbers");
  });

  test("a failed read inside the window restarts it", async () => {
    const h = harness([
      feeds({ statuses: HEALTHY, stamp: "a" }),
      feeds({ statuses: HEALTHY, stamp: "a" }),
      feeds({ statuses: STATS_DOWN }),
      feeds({ statuses: HEALTHY, stamp: "b" }),
    ]);
    await h.join();
    await h.advance(FINAL_SETTLE_INTERVAL_MS); // healthy
    await h.advance(FINAL_SETTLE_INTERVAL_MS); // failed → failure cadence
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS);
    await h.advance(FAILURE_INTERVAL_MS); // healthy again: the run restarts here
    const restarted = h.now();
    assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS);
    await h.advance(FINAL_SETTLE_WINDOW_MS - FINAL_SETTLE_INTERVAL_MS);
    assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS, "the old window's end is not this one's");
    await h.advance(FINAL_SETTLE_INTERVAL_MS);
    assert.equal(h.now() - restarted, FINAL_SETTLE_WINDOW_MS);
    assert.equal(h.nextTickIn(), null);
  });

  test("a game the scoreboard un-finals takes the room back to the live cadence", async () => {
    const h = harness([
      feeds({ statuses: HEALTHY, stamp: "a" }),
      feeds({ statuses: HEALTHY, stamp: "a", games: { pre: 0, live: 1, final: 15 } }),
    ]);
    await h.join();
    await h.advance(FINAL_SETTLE_INTERVAL_MS);
    assert.equal(h.nextTickIn(), LIVE_INTERVAL_MS);
  });
});

describe("the cadences a week still being played keeps", () => {
  test("a running game is the live cadence, with or without a stats line", async () => {
    const live: Games = { pre: 4, live: 3, final: 9 };
    const h = harness([feeds({ games: live })]);
    await h.join();
    assert.equal(h.nextTickIn(), LIVE_INTERVAL_MS);

    // One feed failing during a game is the per-feed degradation the wire
    // already carries, and it keeps the live cadence rather than the failure
    // one — unchanged.
    const degraded = harness([feeds({ games: live, statuses: STATS_DOWN })]);
    await degraded.join();
    assert.equal(degraded.nextTickIn(), LIVE_INTERVAL_MS);
    assert.equal(degraded.frames[0].type, "payload");
  });

  test("games to come wait for the kickoff, bounded by the floor", async () => {
    const h = harness([
      feeds({ games: { pre: 16, live: 0, final: 0 }, nextKickoff: NOW + 5 * 60_000 }),
    ]);
    await h.join();
    assert.equal(h.nextTickIn(), 5 * 60_000 - KICKOFF_LEAD_MS);

    const unknown = harness([feeds({ games: { pre: 16, live: 0, final: 0 }, nextKickoff: null })]);
    await unknown.join();
    assert.equal(unknown.nextTickIn(), WAITING_INTERVAL_MS);
  });

  test("both feeds down mid-week is the failure cadence, and recovery goes back to the board's", async () => {
    const live: Games = { pre: 4, live: 3, final: 9 };
    const h = harness([feeds({ games: live }), feeds({ games: live, statuses: BOTH_DOWN }), feeds({ games: live, stamp: "back" })]);
    await h.join();
    await h.advance(LIVE_INTERVAL_MS);
    assert.equal(h.nextTickIn(), FAILURE_INTERVAL_MS);
    await h.advance(FAILURE_INTERVAL_MS);
    assert.equal(h.nextTickIn(), LIVE_INTERVAL_MS);
  });
});

describe("teardown", () => {
  test("the last reader leaving during finalization leaves no polling chain", async () => {
    const h = harness([feeds({ statuses: HEALTHY, stamp: "final" })]);
    const leave = await h.join();
    await h.advance(FINAL_SETTLE_INTERVAL_MS);
    assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS);

    leave();
    // The linger is armed beside the tick chain; the room keeps ticking until
    // it runs out, in case the reader is a StrictMode remount coming back.
    assert.equal(h.pending().length, 2);
    await h.advance(LINGER_MS);
    assert.equal(h.rooms.stats().weeks, 0, "closed");
    assert.deepEqual(h.pending(), [], "nothing left armed");

    const reads = h.readLog.length;
    await h.advance(FINAL_SETTLE_WINDOW_MS);
    assert.equal(h.readLog.length, reads, "a closed room reads nothing");
  });

  test("a room closed under an in-flight read arms nothing when the read lands", async () => {
    const h = harness([feeds({ statuses: HEALTHY, stamp: "final" })]);
    const gate: { release: (() => void) | null } = { release: null };
    const base = h.deps.readFeeds;
    const leave = await h.join();

    // The next read hangs until the test lets it go.
    h.deps.readFeeds = (season, week) =>
      new Promise((resolve) => {
        gate.release = () => void base(season, week).then(resolve);
      });
    await h.advance(FINAL_SETTLE_INTERVAL_MS);
    assert.ok(gate.release, "a tick is waiting on its read");
    assert.equal(h.nextTickIn(), null, "and nothing is armed while it waits");

    leave();
    await h.advance(LINGER_MS);
    assert.equal(h.rooms.stats().weeks, 0);

    gate.release();
    await h.flush();
    assert.deepEqual(h.pending(), [], "the landed read armed no timer on the closed room");
  });

  test("a room reopened under the same key is not ticked by the room that closed", async () => {
    const h = harness([feeds({ statuses: HEALTHY, stamp: "final" })]);
    const gate: { release: (() => void) | null } = { release: null };
    const base = h.deps.readFeeds;
    const leave = await h.join();

    h.deps.readFeeds = (season, week) =>
      new Promise((resolve) => {
        gate.release = () => void base(season, week).then(resolve);
      });
    await h.advance(FINAL_SETTLE_INTERVAL_MS);
    assert.ok(gate.release, "a tick is waiting on its read");
    leave();
    await h.advance(LINGER_MS);
    assert.equal(h.rooms.stats().weeks, 0);

    // A new reader opens a new room under the same key while the old read is
    // still out. The read that opens it hangs on the same scripted reader.
    h.deps.readFeeds = base;
    await h.join("second");
    assert.equal(h.rooms.stats().weeks, 1);
    assert.equal(h.nextTickIn(), FINAL_SETTLE_INTERVAL_MS, "the new room's own tick");
    const armed = h.pending().length;

    gate.release();
    await h.flush();
    assert.equal(h.pending().length, armed, "the old room's read armed nothing");
    assert.equal(h.rooms.stats().weeks, 1);
  });
});
