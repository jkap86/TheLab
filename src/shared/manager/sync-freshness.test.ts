import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LEAGUE_REFRESH_ATTEMPT_SQL,
  LEAGUE_REFRESH_COOLDOWN_MS,
  MANAGER_SYNC_STAMP_SQL,
  SETTLED_SYNC_TTL_MS,
  SYNC_ATTEMPT_TTL_MS,
  SYNC_TTL_MS,
  leagueRefreshGate,
  managerSyncGate,
  seasonSyncTier,
  syncTtlMsFor,
  type LeagueRefreshState,
  type ManagerSyncState,
  type SeasonSyncTier,
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

describe("seasonSyncTier", () => {
  test("the season being played is active", () => {
    assert.equal(seasonSyncTier("2026", "2026"), "active");
  });

  test("the season just finished is settled", () => {
    assert.equal(seasonSyncTier("2025", "2026"), "settled");
  });

  test("anything older is archive", () => {
    assert.equal(seasonSyncTier("2024", "2026"), "archive");
    assert.equal(seasonSyncTier("2017", "2026"), "archive");
  });

  test("a season ahead of the active one stays active", () => {
    // Sleeper answers an unknown league year with an empty list, and retiring
    // that would make "no leagues yet" permanent until the rollover.
    assert.equal(seasonSyncTier("2027", "2026"), "active");
  });

  test("not knowing the active season falls back to the shortest clock", () => {
    // `peekActiveSeason` answers undefined on a cold process, and the caller is
    // allowed to hand it straight over: extra fetches are the failure you can
    // see, where the other direction retires a live season.
    assert.equal(seasonSyncTier("2024", undefined), "active");
    assert.equal(seasonSyncTier("2024", null), "active");
    assert.equal(seasonSyncTier(undefined, "2026"), "active");
    assert.equal(seasonSyncTier("nonsense", "2026"), "active");
  });
});

describe("syncTtlMsFor", () => {
  test("lengthens as the season recedes", () => {
    assert.equal(syncTtlMsFor("active"), SYNC_TTL_MS);
    assert.equal(syncTtlMsFor("settled"), SETTLED_SYNC_TTL_MS);
    assert.equal(syncTtlMsFor("archive"), Number.POSITIVE_INFINITY);
    assert.ok(SYNC_TTL_MS < SETTLED_SYNC_TTL_MS);
  });
});

describe("a past season's gate", () => {
  const gateAt = (s: ManagerSyncState | null, tier: SeasonSyncTier) =>
    managerSyncGate(s, { now: NOW, requestedAt: NOW, tier });

  const complete = (agoMs: number) =>
    state({ syncedAt: ago(agoMs), attemptAt: ago(agoMs) });

  test("a completely synced archive season is never re-synced", () => {
    // The retirement: a finished season cannot change, so there is nothing a
    // re-fetch could learn. Years later it is still complete and still not run.
    const gate = gateAt(complete(SYNC_TTL_MS * 1_000_000), "archive");
    assert.deepEqual(gate, { run: false, complete: true, reason: "fresh" });
  });

  test("the same state on the active tier is due", () => {
    // The tier is the only thing that differs, which is what makes it the whole
    // of the change.
    const gate = gateAt(complete(SYNC_TTL_MS * 1_000_000), "active");
    assert.equal(gate.run, true);
    assert.equal(gate.complete, false);
  });

  test("last season is held for a month, then asked once more", () => {
    assert.equal(gateAt(complete(SETTLED_SYNC_TTL_MS - 1), "settled").run, false);
    assert.equal(gateAt(complete(SETTLED_SYNC_TTL_MS + 1), "settled").run, true);
  });

  test("an archive season never synced completely is still due", () => {
    // The retirement is bought by `synced_at`, and only a run that dropped no
    // league advances it — so a graph that has never been whole is not retired
    // by having been attempted.
    assert.deepEqual(gateAt(null, "archive"), {
      run: true,
      complete: false,
      reason: "due",
    });
  });

  test("a partial archive sync retries on the ordinary attempt window", () => {
    // The attempt throttle is deliberately untiered: waiting a month — or
    // forever — to retry three leagues a Sleeper timeout dropped is exactly the
    // page where the retry is free and one round of it earns the retirement.
    const partial = (agoMs: number) => state({ syncedAt: null, attemptAt: ago(agoMs) });
    assert.equal(gateAt(partial(SYNC_ATTEMPT_TTL_MS - 1), "archive").reason, "throttled");
    assert.equal(gateAt(partial(SYNC_ATTEMPT_TTL_MS + 1), "archive").run, true);
  });

  test("force still overrides a retired season", () => {
    const gate = managerSyncGate(complete(1_000), {
      now: NOW,
      requestedAt: NOW,
      force: true,
      tier: "archive",
    });
    assert.equal(gate.run, true);
    // It describes the data, not the decision: forcing a refresh over a complete
    // graph is still a complete graph until the new one lands.
    assert.equal(gate.complete, true);
  });

  test("the tier defaults to active, so a caller with no season is unchanged", () => {
    const at = complete(SYNC_TTL_MS + 1);
    assert.deepEqual(
      managerSyncGate(at, { now: NOW, requestedAt: NOW }),
      gateAt(at, "active"),
    );
  });
});

describe("leagueRefreshGate", () => {
  const league = (over: Partial<LeagueRefreshState> = {}): LeagueRefreshState => ({
    updatedAt: null,
    attemptAt: null,
    ...over,
  });

  /** The gate as `refreshLeague` asks it: the press queued for the lock at NOW. */
  const press = (s: LeagueRefreshState | null, requestedAt = NOW) =>
    leagueRefreshGate(s, { now: NOW, requestedAt });

  test("a league nobody has ever pressed or crawled is due", () => {
    assert.deepEqual(press(league()), {
      run: true,
      reason: "due",
      retryAfterMs: 0,
    });
    // A row that has never been read at all answers the same way, which is what
    // lets a first press fill it.
    assert.equal(press(null).run, true);
  });

  test("inside the cooldown it refuses and says exactly how long is left", () => {
    const gate = press(league({ attemptAt: ago(4_000) }));
    assert.equal(gate.run, false);
    assert.equal(gate.reason, "cooldown");
    assert.equal(gate.retryAfterMs, LEAGUE_REFRESH_COOLDOWN_MS - 4_000);
  });

  test("past the cooldown it is due again", () => {
    assert.equal(
      press(league({ attemptAt: ago(LEAGUE_REFRESH_COOLDOWN_MS + 1) })).run,
      true,
    );
  });

  test("a failed attempt buys the same quiet as a successful one", () => {
    // `updatedAt` is untouched — the graph was never written — and the gate
    // still refuses, which is what stops a reader hammering a failing Sleeper.
    const gate = press(league({ updatedAt: null, attemptAt: ago(1_000) }));
    assert.equal(gate.reason, "cooldown");
  });

  test("a race is not a cooldown, and never reports a wait", () => {
    // Somebody else's fan-out landed while this caller queued on the lock. That
    // is the work this press wanted, already done: the reader gets the data
    // rather than a fifteen-second apology for it.
    const requestedAt = NOW - 30_000;
    const gate = press(league({ attemptAt: new Date(NOW - 1) }), requestedAt);
    assert.equal(gate.run, false);
    assert.equal(gate.reason, "raced");
    assert.equal(gate.retryAfterMs, 0);
  });

  test("the race arm wins even where the cooldown would also have caught it", () => {
    // Both are true of an attempt one millisecond old under a caller that
    // queued long ago. Reporting `cooldown` would hide a completed refresh
    // behind a wait, which is the one refusal with nothing behind it.
    assert.equal(
      press(league({ attemptAt: new Date(NOW) }), NOW - 60_000).reason,
      "raced",
    );
  });

  test("an attempt exactly at requestedAt counts as the race", () => {
    // `>=`, not `>`: the winner stamped at the instant we asked, and re-running
    // is the fan-out we queued to avoid.
    assert.equal(press(league({ attemptAt: new Date(NOW) }), NOW).reason, "raced");
  });

  test("a clock that stepped backwards never reports a negative wait", () => {
    const gate = leagueRefreshGate(league({ attemptAt: new Date(NOW + 5_000) }), {
      now: NOW,
      requestedAt: NOW + 10_000,
    });
    assert.ok(gate.retryAfterMs >= 0);
  });

  test("the cooldown stays a hammer bound rather than a freshness TTL", () => {
    // The press exists to be believed by a reader who changed something in
    // Sleeper a moment ago. A window long enough to be a staleness policy would
    // refuse exactly the press the key is for.
    assert.ok(LEAGUE_REFRESH_COOLDOWN_MS < SYNC_TTL_MS / 10);
  });

  test("the attempt stamp names only sync_attempt_at", () => {
    // `updated_at` means "this graph was written whole" and is
    // `persistLeagueGraph`'s alone. A press that moved it would have a league
    // nobody managed to read claim it was refreshed this second.
    assert.match(LEAGUE_REFRESH_ATTEMPT_SQL, /sync_attempt_at = now\(\)/);
    assert.doesNotMatch(LEAGUE_REFRESH_ATTEMPT_SQL, /updated_at/);
  });
});
