import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { databaseBudget } from "../db/budget.ts";
import {
  createManagerSyncAdmission,
  managerSyncConcurrency,
} from "./sync-admission.ts";

/**
 * The process-wide bound on manager synchronisation.
 *
 * What is under test is the property the retired cold-sync counter did not have:
 * that the bound covers *every* shape this work takes. A cached-but-stale
 * refresh is the same ~11-requests-per-league fan-out as a cold sync and holds
 * the same advisory-lock connection for its whole duration, and it used to skip
 * the counter entirely — so any number of stale managers could refresh at once
 * and take the pool the persistence underneath them was queued for.
 *
 * The assertions are *counts of concurrent reservations*, which is what the
 * work was for, and the release paths are the other half: a permit leaked per
 * failed sync is a cap that tightens to zero, and a permit released twice is a
 * cap that widens for good.
 */

/** One request's worth of work, as the route reserves it. */
type Held = { release: () => void };

/** Reserve, asserting it was admitted, and hand back the release. */
function admit(
  admission: ReturnType<typeof createManagerSyncAdmission>,
  key: string,
  dedupe: boolean,
): Held {
  const reservation = admission.reserve(key, { dedupe });
  assert.ok(reservation.ok, `expected ${key} to be admitted`);
  return reservation;
}

describe("managerSyncConcurrency", () => {
  test("defaults to the database budget's fan-out share", () => {
    // A share of the pool rather than a number of its own: a manager sync holds
    // a Postgres session for its whole duration, so what bounds it honestly is
    // how much of the pool one request may hold.
    const budget = databaseBudget({});
    assert.equal(managerSyncConcurrency({}), budget.fanout);
    assert.equal(managerSyncConcurrency({}), 3, "three at the default pool size");
  });

  test("follows the pool size rather than being pinned to three", () => {
    assert.equal(
      managerSyncConcurrency({ DATABASE_POOL_MAX: "30" }),
      databaseBudget({ DATABASE_POOL_MAX: "30" }).fanout,
    );
  });

  test("reads a positive integer override", () => {
    assert.equal(managerSyncConcurrency({ MANAGER_SYNC_LIMIT: " 5 " }), 5);
  });

  test("falls back rather than failing on junk", () => {
    const fallback = databaseBudget({}).fanout;
    for (const value of ["", "lots", "0", "-2", "1.5"]) {
      assert.equal(
        managerSyncConcurrency({ MANAGER_SYNC_LIMIT: value }),
        fallback,
        value,
      );
    }
  });

  test("ignores the retired cold-sync knob", () => {
    // `MANAGER_COLD_SYNC_LIMIT` bounded a strict subset of this, so honouring it
    // here would silently re-scope whatever it was set to.
    assert.equal(
      managerSyncConcurrency({ MANAGER_COLD_SYNC_LIMIT: "40" }),
      databaseBudget({}).fanout,
    );
  });
});

describe("createManagerSyncAdmission", () => {
  test("bounds stale refreshes of different managers", () => {
    // The regression: every one of these has cached leagues to serve, so every
    // one of them used to skip the cold-sync counter and run.
    const admission = createManagerSyncAdmission(3);
    const held: Held[] = [];

    for (const manager of ["alice", "bob", "carol"]) {
      held.push(admit(admission, `${manager}:2026`, true));
    }
    assert.equal(admission.stats().active, 3);

    for (const manager of ["dave", "erin", "frank"]) {
      const refused = admission.reserve(`${manager}:2026`, { dedupe: true });
      assert.equal(refused.ok, false);
      assert.equal(refused.ok === false && refused.reason, "busy");
    }
    assert.equal(admission.stats().active, 3, "refusals cost no permit");

    held.forEach((h) => h.release());
    assert.equal(admission.stats().active, 0);
  });

  test("counts cold syncs against the same cap as stale refreshes", () => {
    // One cap over both shapes, which is the whole change: two cold callers and
    // one stale one is three syncs however they arrived.
    const admission = createManagerSyncAdmission(3);
    admit(admission, "alice:2026", false);
    admit(admission, "bob:2026", false);
    admit(admission, "carol:2026", true);

    for (const dedupe of [true, false]) {
      const refused = admission.reserve("dave:2026", { dedupe });
      assert.equal(refused.ok, false, `dedupe=${dedupe}`);
      assert.equal(refused.ok === false && refused.reason, "busy");
    }
    assert.equal(admission.stats().peak, 3);
  });

  test("never admits more than the cap however many managers arrive", () => {
    const cap = 3;
    const admission = createManagerSyncAdmission(cap);
    const held: Held[] = [];
    let admitted = 0;

    // Fifty distinct managers, each releasing only after ten more have tried —
    // the shape a burst of traffic takes, with no two of them contending on an
    // advisory lock.
    for (let i = 0; i < 50; i++) {
      const reservation = admission.reserve(`m${i}:2026`, { dedupe: true });
      if (reservation.ok) {
        admitted += 1;
        held.push(reservation);
      }
      assert.ok(
        admission.stats().active <= cap,
        `active reached ${admission.stats().active}`,
      );
      if (i % 10 === 9) held.shift()?.release();
    }

    assert.equal(admission.stats().peak, cap);
    // Three at a time, plus one more admitted at each of the four releases.
    assert.equal(admitted, cap + 4);
    held.forEach((h) => h.release());
    assert.equal(admission.stats().active, 0);
  });

  test("deduplicates concurrent requests for one manager", () => {
    const admission = createManagerSyncAdmission(3);
    admit(admission, "alice:2026", true);

    const second = admission.reserve("alice:2026", { dedupe: true });
    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.reason, "duplicate");
    assert.equal(
      admission.stats().active,
      1,
      "a duplicate never occupies a permit, or two tabs would spend two of three",
    );
  });

  test("keys on the season as well as the manager", () => {
    // One manager's two seasons are two league graphs, so they are not each
    // other's duplicate.
    const admission = createManagerSyncAdmission(3);
    admit(admission, "alice:2026", true);
    admit(admission, "alice:2025", true);
    assert.equal(admission.stats().active, 2);
  });

  test("does not refuse a cold caller as a duplicate", () => {
    // A cold caller has nothing cached to serve instead and needs its own
    // progress stream; the advisory lock inside the sync is what keeps the two
    // from repeating each other's fan-out.
    const admission = createManagerSyncAdmission(3);
    admit(admission, "alice:2026", false);
    admit(admission, "alice:2026", false);
    assert.equal(admission.stats().active, 2);
  });

  test("a cold sync in flight still dedupes a cached caller behind it", () => {
    // What the route's own map did: by the time this arrives the cold sync has
    // committed some leagues, so there is cache to serve and no reason to run a
    // second fan-out over it.
    const admission = createManagerSyncAdmission(3);
    admit(admission, "alice:2026", false);
    const cached = admission.reserve("alice:2026", { dedupe: true });
    assert.equal(cached.ok, false);
    assert.equal(cached.ok === false && cached.reason, "duplicate");
  });

  test("frees the permit and the key when a sync fails", () => {
    // The route releases in a `finally`, so a thrown sync looks like this.
    const admission = createManagerSyncAdmission(1);
    for (let i = 0; i < 5; i++) {
      const held = admit(admission, "alice:2026", true);
      try {
        throw new Error("Sleeper timed out");
      } catch {
        held.release();
      }
      assert.equal(admission.stats().active, 0, `after failure ${i}`);
    }

    // And the manager is reservable again rather than being stuck as a duplicate
    // of a sync that is no longer running.
    admit(admission, "alice:2026", true);
    assert.equal(admission.stats().active, 1);
  });

  test("a thrown sync cannot permanently reduce the available concurrency", () => {
    const admission = createManagerSyncAdmission(3);
    for (let i = 0; i < 20; i++) {
      const held = admit(admission, `m${i}:2026`, true);
      held.release();
    }
    // Still the full width afterwards, rather than a cap that tightened by one
    // per failure until it admitted nobody.
    const held = ["a", "b", "c"].map((k) => admit(admission, `${k}:2026`, true));
    assert.equal(admission.stats().active, 3);
    assert.equal(admission.reserve("d:2026", { dedupe: true }).ok, false);
    held.forEach((h) => h.release());
  });

  test("a doubled release does not widen the cap", () => {
    // The opposite failure to a leak, and the worse one: it is permanent. A
    // `finally` reachable on two paths is the ordinary way it happens.
    const admission = createManagerSyncAdmission(1);
    const held = admit(admission, "alice:2026", true);
    held.release();
    held.release();
    held.release();
    assert.equal(admission.stats().active, 0);

    admit(admission, "bob:2026", true);
    assert.equal(admission.stats().active, 1);
    assert.equal(
      admission.reserve("carol:2026", { dedupe: true }).ok,
      false,
      "the cap is still one",
    );
  });

  test("a refused caller proceeds once a permit is released", () => {
    const admission = createManagerSyncAdmission(2);
    const first = admit(admission, "alice:2026", true);
    admit(admission, "bob:2026", true);

    assert.equal(admission.reserve("carol:2026", { dedupe: true }).ok, false);
    first.release();
    // Nothing queued — a caller that was refused serves its cache and the next
    // request is the retry, which is why the permit is available immediately
    // rather than handed to somebody holding a response open.
    const carol = admission.reserve("carol:2026", { dedupe: true });
    assert.equal(carol.ok, true);
    assert.equal(admission.stats().active, 2);
  });

  test("a client that disconnects mid-sync still gives its permit back", async () => {
    // Nothing in the sync stack takes an `AbortSignal` — `sleeperGet` has no
    // parameter for one — so a browser that goes away mid-stream does not stop
    // the sync it started, and that is deliberate: a cold sync is filling shared
    // Postgres state rather than this request's answer, the same reason a
    // background refresh is allowed to outlive its caller. What must not happen
    // is the permit going with the reader: the route releases in a `finally`
    // reached on every path out, so the slot is occupied for the run and not
    // beyond it.
    const admission = createManagerSyncAdmission(1);

    /** The route's stream, with the client gone before the sync returns. */
    const serve = async (key: string, sync: () => Promise<void>) => {
      const reservation = admission.reserve(key, { dedupe: false });
      if (!reservation.ok) return "shed";
      let closed = false;
      const send = () => {
        if (closed) return;
        // `controller.enqueue` throws once the consumer has gone; the route
        // swallows it and stops writing, which is all a disconnect changes.
        closed = true;
      };
      try {
        send();
        await sync();
        send(); // the closing `result`, into a stream nobody is reading
        return "synced";
      } finally {
        reservation.release();
      }
    };

    assert.equal(
      await serve("alice:2026", async () => {
        // Mid-sync, the permit is spent — this instance is at its cap.
        assert.equal(admission.stats().active, 1);
        assert.equal(admission.reserve("bob:2026", { dedupe: true }).ok, false);
      }),
      "synced",
      "the disconnect does not cancel the sync",
    );
    assert.equal(admission.stats().active, 0, "and the permit comes back");

    // A sync that throws behind a disconnected client is the same story.
    await assert.rejects(
      serve("carol:2026", async () => {
        throw new Error("Sleeper timed out");
      }),
      /Sleeper timed out/,
    );
    assert.equal(admission.stats().active, 0);

    // So the next manager is admitted rather than meeting a cap that tightened
    // by one per abandoned request.
    admit(admission, "dave:2026", false);
    assert.equal(admission.stats().active, 1);
  });

  test("a cap below one is still one", () => {
    // Zero would be a manager tool that never syncs, dressed as configuration.
    for (const cap of [0, -1]) {
      const admission = createManagerSyncAdmission(cap);
      admit(admission, "alice:2026", true);
      assert.equal(admission.stats().limit, 1, String(cap));
    }
  });
});
