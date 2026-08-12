import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { lockedPlayers } from "./locks.ts";

/**
 * The lock decides which moves this tool may recommend at all, and both ways of
 * getting it wrong are silent: a player locked late is advice Sleeper refuses,
 * and one locked early is a legal move withheld. The rule worth pinning is the
 * asymmetry — the schedule may only ever lock a player *earlier* than the day
 * flag, never unlock one it has settled.
 */

// A Thursday-night kickoff and the Sunday 1 PM ET after it, epoch ms.
const THU = 1789086000000;
const SUN = 1789318800000;

const args = {
  playerIds: ["thu", "sun", "bye", "unknown"],
  dayLocked: new Set<string>(),
  teams: {
    thu: "PHI",
    sun: "KC",
    bye: null,
    // `unknown` deliberately absent — a player the cache doesn't know.
  } as Record<string, string | null>,
  kickoffs: new Map([
    ["PHI", THU],
    ["KC", SUN],
  ]),
};

describe("lockedPlayers", () => {
  test("locks at the minute, not at midnight", () => {
    // Friday morning of the same date: the day flag hasn't rolled over yet,
    // which is exactly the case this refinement exists for.
    const locked = lockedPlayers({ ...args, now: THU + 60_000 });
    assert.ok(locked.has("thu"));
    assert.ok(!locked.has("sun"));
  });

  test("the instant of kickoff itself is locked", () => {
    // Sleeper locks *at* kickoff; the movable reading of that minute would
    // name a move already refused.
    assert.ok(lockedPlayers({ ...args, now: THU }).has("thu"));
    assert.ok(!lockedPlayers({ ...args, now: THU - 1 }).has("thu"));
  });

  test("never unlocks a player the day rule has settled", () => {
    // A postponed game: the date passed, the schedule now claims a future
    // kickoff. Trusting it to unlock would let one stale schedule row
    // recommend a move on a game that may well have been played.
    const locked = lockedPlayers({
      ...args,
      dayLocked: new Set(["sun"]),
      now: THU - 1,
    });
    assert.ok(locked.has("sun"));
  });

  test("a player the schedule cannot date keeps the day answer", () => {
    // No team on file, a team with no game this week, and an id the cache
    // doesn't know: all three are "not known", which is never a lock.
    const movable = lockedPlayers({ ...args, now: SUN + 1 });
    assert.ok(!movable.has("bye"));
    assert.ok(!movable.has("unknown"));

    const settled = lockedPlayers({
      ...args,
      dayLocked: new Set(["bye"]),
      now: THU - 1,
    });
    assert.ok(settled.has("bye"));
  });

  test("locks a player the stats have no row for", () => {
    // A starter who is out this week has no projection row and so no day flag,
    // but his team's game still kicks off and Sleeper still locks him — the
    // ids driving the kickoff half are the roster union, not the stats rows.
    const locked = lockedPlayers({ ...args, now: SUN });
    assert.ok(locked.has("sun"));
  });

  test("an empty schedule is exactly the day answer, and the input survives", () => {
    const dayLocked = new Set(["thu"]);
    const locked = lockedPlayers({
      ...args,
      dayLocked,
      kickoffs: new Map(),
      now: SUN,
    });
    assert.deepEqual(locked, new Set(["thu"]));

    // A fresh set, not the caller's — the fold must not write into an input.
    locked.add("sun");
    assert.deepEqual(dayLocked, new Set(["thu"]));
  });
});
