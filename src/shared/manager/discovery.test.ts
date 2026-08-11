import assert from "node:assert/strict";
import { test } from "node:test";

import {
  remainingDue,
  selectDiscoveryLeagues,
  stampableManagers,
  unrecordedFailures,
} from "./discovery.ts";

type League = { league_id: string };

/** A stand-in for the two fields the selection reads off a Sleeper league. */
const league = (id: string) => ({ league_id: id }) as never;

const enumerated = (entries: Record<string, string[]>) =>
  new Map<string, League[]>(
    Object.entries(entries).map(([userId, ids]) => [userId, ids.map(league)]),
  ) as never;

const ids = (selection: { leagues: League[] }) =>
  selection.leagues.map((l) => l.league_id).sort();

test("every discovered league succeeds — the manager is stamped", () => {
  const selection = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["a", "b"] }),
    new Set(),
    10,
  );
  assert.deepEqual(ids(selection), ["a", "b"]);
  assert.deepEqual(selection.eligible, ["u1"]);
  assert.deepEqual(stampableManagers(selection, new Set()), ["u1"]);
});

test("one of several newly discovered leagues fails — the manager is not stamped", () => {
  const selection = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["a", "b", "c"] }),
    new Set(),
    10,
  );
  assert.deepEqual(stampableManagers(selection, new Set(["b"])), []);
});

test("enumeration succeeds with zero unknown leagues — stamped, nothing fetched", () => {
  const selection = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["a", "b"] }),
    new Set(["a", "b"]),
    10,
  );
  assert.deepEqual(selection.leagues, []);
  assert.deepEqual(stampableManagers(selection, new Set()), ["u1"]);
});

test("enumeration itself fails — neither eligible nor deferred, and never stamped", () => {
  // `u2` is absent from the map: their `getUserLeagues` call threw.
  const selection = selectDiscoveryLeagues(
    ["u1", "u2"],
    enumerated({ u1: ["a"] }),
    new Set(),
    10,
  );
  assert.deepEqual(selection.eligible, ["u1"]);
  assert.deepEqual(selection.deferred, []);
  assert.deepEqual(stampableManagers(selection, new Set()), ["u1"]);
});

test("more unknown leagues than the remaining cap — a capful is taken, unstamped", () => {
  const selection = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["a", "b", "c", "d", "e"] }),
    new Set(),
    2,
  );
  assert.equal(selection.leagues.length, 2);
  assert.deepEqual(selection.eligible, []);
  assert.deepEqual(selection.deferred, ["u1"]);
  assert.deepEqual(stampableManagers(selection, new Set()), []);
});

test("the cap stops the pass — later managers are deferred, not silently dropped", () => {
  const selection = selectDiscoveryLeagues(
    ["u1", "u2", "u3"],
    enumerated({ u1: ["a", "b"], u2: ["c", "d"], u3: ["e"] }),
    new Set(),
    3,
  );
  assert.deepEqual(selection.eligible, ["u1"]);
  assert.deepEqual(selection.deferred, ["u2", "u3"]);
  assert.equal(selection.leagues.length, 3);
});

test("two managers sharing an unknown league — fetched once, attributed to both", () => {
  const selection = selectDiscoveryLeagues(
    ["u1", "u2"],
    enumerated({ u1: ["shared", "a"], u2: ["shared", "b"] }),
    new Set(),
    10,
  );
  assert.deepEqual(ids(selection), ["a", "b", "shared"]);
  assert.deepEqual([...(selection.selectedByManager.get("u2") ?? [])].sort(), [
    "b",
    "shared",
  ]);
  assert.deepEqual(stampableManagers(selection, new Set()).sort(), ["u1", "u2"]);
});

test("a shared league failing unstamps every manager waiting on it", () => {
  const selection = selectDiscoveryLeagues(
    ["u1", "u2", "u3"],
    enumerated({ u1: ["shared"], u2: ["shared", "b"], u3: ["c"] }),
    new Set(),
    10,
  );
  assert.deepEqual(stampableManagers(selection, new Set(["shared"])), ["u3"]);
});

test("an unstamped manager stays at the front of the queue, not suppressed for the TTL", () => {
  // Tick one: `b` fails, so `u1` is not stamped — which is what leaves them in
  // `pendingManagers` next tick rather than hidden for the six-hour TTL.
  const first = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["a", "b"] }),
    new Set(),
    10,
  );
  assert.deepEqual(stampableManagers(first, new Set(["b"])), []);

  // Tick two: `a` is stored now, `b` is still unknown, and this time it lands.
  const second = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["a", "b"] }),
    new Set(["a"]),
    10,
  );
  assert.deepEqual(ids(second), ["b"]);
  assert.deepEqual(stampableManagers(second, new Set()), ["u1"]);
});

test("a duplicate league id in one manager's list is fetched once", () => {
  const selection = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["a", "a", "b"] }),
    new Set(),
    10,
  );
  assert.deepEqual(ids(selection), ["a", "b"]);
});

test("a league that was written down no longer blocks its managers", () => {
  const selection = selectDiscoveryLeagues(
    ["u1", "u2"],
    enumerated({ u1: ["a", "b"], u2: ["c"] }),
    new Set(),
    10,
  );
  // `a` was tombstoned and `c` parked — both have rows, so neither is a reason
  // to hold a manager back. `b` synced.
  const blocked = unrecordedFailures(["a", "c"], new Set(["a", "c"]));
  assert.deepEqual(blocked, new Set());
  assert.deepEqual(stampableManagers(selection, blocked).sort(), ["u1", "u2"]);
});

test("a failure nothing could be written for still blocks", () => {
  // The residual case: a failed id the tick held no league payload for, so
  // there was nothing to write a row from and nothing else points at it.
  const selection = selectDiscoveryLeagues(
    ["u1", "u2"],
    enumerated({ u1: ["a"], u2: ["b"] }),
    new Set(),
    10,
  );
  const blocked = unrecordedFailures(["a", "b"], new Set(["b"]));
  assert.deepEqual(blocked, new Set(["a"]));
  assert.deepEqual(stampableManagers(selection, blocked), ["u2"]);
});

test("recording is judged on ids written, never on ids attempted", () => {
  // Passing the intent rather than the outcome is the one way to lose a league
  // for good: the manager is suppressed for the enumeration TTL on the strength
  // of a row that was never written.
  assert.deepEqual(unrecordedFailures(["a", "b"], new Set()), new Set(["a", "b"]));
  assert.deepEqual(unrecordedFailures([], new Set(["a"])), new Set());
  // An id recorded but not failed is simply not this function's business.
  assert.deepEqual(unrecordedFailures(["a"], new Set(["a", "z"])), new Set());
});

test("the wedge: a permanently failing league stops holding the queue once parked", () => {
  // Tick one, as it used to go forever — `bad` fails, nothing is written for
  // it, so `u1` is not stamped and returns to the head of `pendingManagers`.
  const first = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["good", "bad"] }),
    new Set(),
    10,
  );
  assert.deepEqual(
    stampableManagers(first, unrecordedFailures(["bad"], new Set())),
    [],
  );

  // Tick two, with parking: `bad` still fails, but Sleeper serves it, so a row
  // is written and the hold is released. `u1` retires for the enumeration TTL
  // and the queue moves on to somebody else.
  const second = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["good", "bad"] }),
    new Set(["good"]),
    10,
  );
  assert.deepEqual(
    stampableManagers(second, unrecordedFailures(["bad"], new Set(["bad"]))),
    ["u1"],
  );

  // Tick three: `bad` now has a row, so it is *known* and never selected again
  // — the refresh pass owns it from here.
  const third = selectDiscoveryLeagues(
    ["u1"],
    enumerated({ u1: ["good", "bad"] }),
    new Set(["good", "bad"]),
    10,
  );
  assert.deepEqual(third.leagues, []);
  assert.deepEqual(stampableManagers(third, new Set()), ["u1"]);
});

test("remainingDue retires both refreshed and tombstoned leagues", () => {
  assert.equal(remainingDue(20, 5, 0), 15); // loaded only
  assert.equal(remainingDue(20, 0, 3), 17); // gone only
  assert.equal(remainingDue(20, 5, 3), 12); // mixed
  assert.equal(remainingDue(20, 0, 0), 20); // failures stay due
  assert.equal(remainingDue(2, 5, 5), 0); // never negative
});
