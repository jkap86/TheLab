import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LEAGUE_REFRESH_ATTEMPT_SQL,
  LEAGUE_REFRESH_COOLDOWN_MS,
  MANAGER_SYNC_STAMP_SQL,
  SYNC_ATTEMPT_TTL_MS,
  SYNC_TTL_MS,
  leagueRefreshGate,
  managerSyncGate,
  type LeagueRefreshState,
  type ManagerSyncState,
} from "./sync-freshness.ts";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => new Date(NOW - ms);

const state = (over: Partial<ManagerSyncState> = {}): ManagerSyncState => ({
  syncedAt: null,
  attemptAt: null,
  ...over,
});

/** The gate as the leagues route asks it: nothing has been queued for yet. */
const gateNow = (s: ManagerSyncState | null, force = false) =>
  managerSyncGate(s, { now: NOW, requestedAt: NOW, force });

describe("managerSyncGate", () => {
  test("a manager nobody has ever synced is due", () => {
    const gate = gateNow(null);
    assert.deepEqual(gate, { run: true, complete: false, reason: "due" });
  });

  test("a fully successful sync inside the TTL is fresh and complete", () => {
    const gate = gateNow(state({ syncedAt: ago(60_000), attemptAt: ago(60_000) }));
    assert.deepEqual(gate, { run: false, complete: true, reason: "fresh" });
  });

  test("past the TTL it is due again", () => {
    const at = ago(SYNC_TTL_MS + 1);
    const gate = gateNow(state({ syncedAt: at, attemptAt: at }));
    assert.deepEqual(gate, { run: true, complete: false, reason: "due" });
  });

  describe("a partial sync", () => {
    // The whole point of two columns: `attempt_at` moved, `synced_at` did not.
    const partial = (agoMs: number) => state({ syncedAt: null, attemptAt: ago(agoMs) });

    test("is never complete, however recent", () => {
      assert.equal(gateNow(partial(1_000)).complete, false);
      assert.equal(gateNow(partial(SYNC_TTL_MS * 10)).complete, false);
    });

    test("is throttled rather than retried on the next request", () => {
      // The retry storm this exists to prevent: `synced_at` no longer advances
      // on a partial run, so without the attempt window every request would
      // re-run the whole ~11-requests-per-league fan-out until Sleeper recovered.
      const gate = gateNow(partial(1_000));
      assert.deepEqual(gate, { run: false, complete: false, reason: "throttled" });
    });

    test("comes back once the attempt window expires", () => {
      const gate = gateNow(partial(SYNC_ATTEMPT_TTL_MS + 1));
      assert.deepEqual(gate, { run: true, complete: false, reason: "due" });
    });

    test("does not lose an older complete sync's claim", () => {
      // Fully synced a minute ago, partially synced a second ago: the older
      // success is still inside its TTL, so the graph is still current.
      const gate = gateNow(state({ syncedAt: ago(60_000), attemptAt: ago(1_000) }));
      assert.equal(gate.complete, true);
      assert.equal(gate.run, false);
    });
  });

  describe("force", () => {
    test("overrides freshness", () => {
      const gate = gateNow(state({ syncedAt: ago(1_000), attemptAt: ago(1_000) }), true);
      assert.equal(gate.run, true);
    });

    test("overrides the attempt throttle", () => {
      const gate = gateNow(state({ attemptAt: ago(1_000) }), true);
      assert.equal(gate.run, true);
    });

    test("does not change what is *stored*", () => {
      // `complete` describes the data, not the decision: an operator forcing a
      // refresh over a complete graph is still looking at a complete graph until
      // the new one lands.
      assert.equal(gateNow(state({ syncedAt: ago(1_000) }), true).complete, true);
      assert.equal(gateNow(state({ attemptAt: ago(1_000) }), true).complete, false);
    });

    test("never overrides a race", () => {
      // Forcing means "the caller decided a refresh is due", and the winner of
      // the lock just did that refresh — or just tried, which is as good a
      // reason not to repeat the fan-out a millisecond later.
      const queued = NOW - 5_000;
      const raced = managerSyncGate(state({ syncedAt: new Date(NOW) }), {
        now: NOW, requestedAt: queued, force: true,
      });
      assert.deepEqual(raced, { run: false, complete: true, reason: "raced" });
    });
  });

  describe("a caller that waited on the lock", () => {
    // `requestedAt` is when it started queueing, so a timestamp at or after it
    // belongs to whoever held the lock.
    const queued = NOW - 30_000;
    const asWaiter = (s: ManagerSyncState) =>
      managerSyncGate(s, { now: NOW, requestedAt: queued });

    test("takes a completed sync as its own", () => {
      const gate = asWaiter(state({ syncedAt: ago(1_000), attemptAt: ago(1_000) }));
      assert.deepEqual(gate, { run: false, complete: true, reason: "raced" });
    });

    test("stands down for a partial one too, but does not call it complete", () => {
      // Running again immediately is the fan-out the lock exists to prevent; the
      // list it hands back is the holder's, and short of final.
      const gate = asWaiter(state({ syncedAt: null, attemptAt: ago(1_000) }));
      assert.deepEqual(gate, { run: false, complete: false, reason: "raced" });
    });

    test("still runs when nothing landed while it waited", () => {
      // Both stamps predate the wait *and* both windows have expired, so the
      // race arms stand down and the ordinary rules decide.
      const at = ago(SYNC_TTL_MS + 1);
      const gate = asWaiter(state({ syncedAt: at, attemptAt: at }));
      assert.deepEqual(gate, { run: true, complete: false, reason: "due" });
    });

    test("a stamp from before the wait is still only a throttle", () => {
      // Not `raced`: nobody wrote anything while this caller queued, so what is
      // suppressing it is the ordinary attempt window and it should say so.
      const gate = asWaiter(state({ attemptAt: new Date(queued - 1) }));
      assert.deepEqual(gate, { run: false, complete: false, reason: "throttled" });
    });
  });
});

describe("MANAGER_SYNC_STAMP_SQL", () => {
  test("attempt_at advances unconditionally", () => {
    // What the next caller's throttle reads. A failed run has to move it, or the
    // failure becomes a retry loop — the protection the old always-advancing
    // `synced_at` bought by lying.
    assert.match(MANAGER_SYNC_STAMP_SQL, /SET attempt_at = now\(\)/);
    const setClause = MANAGER_SYNC_STAMP_SQL.slice(
      MANAGER_SYNC_STAMP_SQL.indexOf("SET attempt_at"),
    );
    assert.doesNotMatch(setClause.split("synced_at")[0], /CASE/);
  });

  test("synced_at advances only on a complete run, and otherwise keeps its value", () => {
    // Not `now()`, and not NULL either: a manager fully synced an hour ago and
    // partially synced a minute ago still reports the hour-old success.
    assert.match(
      MANAGER_SYNC_STAMP_SQL,
      /synced_at = CASE WHEN \$3::boolean THEN now\(\)\s*\n?\s*ELSE manager_syncs\.synced_at END/,
    );
  });

  test("a first row for an incomplete run records no success at all", () => {
    assert.match(
      MANAGER_SYNC_STAMP_SQL,
      /VALUES \(\$1, \$2, CASE WHEN \$3::boolean THEN now\(\) ELSE NULL END, now\(\)\)/,
    );
  });

  test("it binds all three values and splices none", () => {
    const used = [...MANAGER_SYNC_STAMP_SQL.matchAll(/\$(\d+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(used)].sort(), ["1", "2", "3"]);
    // The boolean is cast rather than left to inference: Postgres cannot resolve
    // a bare parameter's type inside `CASE WHEN`.
    assert.doesNotMatch(MANAGER_SYNC_STAMP_SQL, /WHEN \$3 THEN/);
  });

  test("it upserts on the table's own key", () => {
    assert.match(
      MANAGER_SYNC_STAMP_SQL,
      /ON CONFLICT \(user_id, season\) DO UPDATE/,
    );
  });
});

describe("the two TTLs", () => {
  test("an attempt buys exactly as much quiet as a success used to", () => {
    // Before the split, a partial sync stamped `synced_at` and bought
    // SYNC_TTL_MS of quiet. A manager whose leagues keep half-failing must not
    // start costing *more* upstream traffic than one whose leagues succeed.
    assert.equal(SYNC_ATTEMPT_TTL_MS, SYNC_TTL_MS);
  });
});

const refreshState = (attemptAt: Date | null): LeagueRefreshState => ({
  updatedAt: null,
  attemptAt,
});

/** The gate as the refresh asks it when nothing was queued for. */
const refreshNow = (s: LeagueRefreshState | null) =>
  leagueRefreshGate(s, { now: NOW, requestedAt: NOW });

describe("leagueRefreshGate", () => {
  test("a league nobody has ever asked about is due", () => {
    assert.deepEqual(refreshNow(null), {
      run: true,
      reason: "due",
      retryAfterMs: 0,
    });
    assert.deepEqual(refreshNow(refreshState(null)), {
      run: true,
      reason: "due",
      retryAfterMs: 0,
    });
  });

  test("a press inside the cooldown is refused, and told how long to wait", () => {
    const gate = refreshNow(refreshState(ago(5_000)));
    assert.equal(gate.run, false);
    assert.equal(gate.reason, "cooldown");
    assert.equal(gate.retryAfterMs, LEAGUE_REFRESH_COOLDOWN_MS - 5_000);
  });

  test("past the cooldown it is due again", () => {
    const gate = refreshNow(refreshState(ago(LEAGUE_REFRESH_COOLDOWN_MS)));
    assert.deepEqual(gate, { run: true, reason: "due", retryAfterMs: 0 });
  });

  test("a refresh that landed while this caller queued is a race, not a cooldown", () => {
    // The distinction the whole gate exists for: this caller started waiting on
    // the lock at `requestedAt` and somebody else's fan-out finished after that,
    // so what is stored is exactly what was asked for. Reported as a throttle it
    // would tell a reader their data is stale at its very freshest.
    const queuedAt = NOW - 30_000;
    const gate = leagueRefreshGate(refreshState(ago(2_000)), {
      now: NOW,
      requestedAt: queuedAt,
    });
    assert.deepEqual(gate, { run: false, reason: "raced", retryAfterMs: 0 });
  });

  test("a race is never reported as a wait, however recent the attempt", () => {
    // `retryAfterMs` is what a client counts down; a race has nothing to wait
    // for, so a non-zero value here would park a key that should be live.
    const gate = leagueRefreshGate(refreshState(new Date(NOW)), {
      now: NOW,
      requestedAt: NOW - 1,
    });
    assert.equal(gate.retryAfterMs, 0);
  });

  test("the cooldown is short enough to serve the press it exists for", () => {
    // It is a hammer bound rather than a freshness policy: a reader sets a
    // lineup in Sleeper and comes straight back, so a window anywhere near the
    // manager TTL would refuse exactly the press this is built for.
    assert.ok(LEAGUE_REFRESH_COOLDOWN_MS < SYNC_TTL_MS / 10);
  });
});

describe("LEAGUE_REFRESH_ATTEMPT_SQL", () => {
  test("it stamps the attempt and never the write", () => {
    // `updated_at` is what says a graph landed and `persistLeagueGraph` owns it.
    // Stamping it here would report a failed fetch as a successful sync to the
    // crawler's own queue, which reads exactly that column to decide what is due.
    assert.match(LEAGUE_REFRESH_ATTEMPT_SQL, /SET sync_attempt_at = now\(\)/);
    assert.doesNotMatch(LEAGUE_REFRESH_ATTEMPT_SQL, /updated_at/);
  });

  test("it addresses one league, by a bound parameter", () => {
    assert.match(LEAGUE_REFRESH_ATTEMPT_SQL, /WHERE league_id = \$1/);
    const used = [...LEAGUE_REFRESH_ATTEMPT_SQL.matchAll(/\$(\d+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(used)], ["1"]);
  });
});
