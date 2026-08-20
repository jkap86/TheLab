import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { databaseBudget } from "../db/budget.ts";
import {
  createManagerSyncAdmission,
  managerSyncConcurrency,
  managerSyncLimit,
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
    // Within the share it is honoured exactly, which is what the knob is for:
    // an operator asking for *less* sync concurrency gets less.
    assert.equal(managerSyncConcurrency({ MANAGER_SYNC_LIMIT: " 2 " }), 2);
    assert.equal(managerSyncConcurrency({ MANAGER_SYNC_LIMIT: "3" }), 3);
  });

  test("the override is a request, not a grant", () => {
    // The hole this closes: `MANAGER_SYNC_LIMIT=10` on the default pool of ten
    // let concurrent manager syncs hold every connection the process has —
    // exactly what the fan-out share exists to prevent, arrived at through the
    // variable meant to prevent it, with nothing failing to say so. Each sync
    // holds an advisory-lock session across a whole Sleeper fan-out, so the
    // ceiling is what one request may hold and nothing above it.
    const fanout = databaseBudget({}).fanout;
    for (const value of ["4", "10", "100", "1000000"]) {
      assert.equal(
        managerSyncConcurrency({ MANAGER_SYNC_LIMIT: value }),
        fanout,
        value,
      );
    }
    assert.equal(managerSyncConcurrency({ MANAGER_SYNC_LIMIT: "10" }), 3);
  });

  test("the clamp holds across pool sizes", () => {
    // The property rather than the table: however the pool is sized and however
    // much is asked for, manager syncs never claim more of it than a single
    // request may hold.
    for (const poolMax of ["2", "3", "4", "10", "12", "30", "100"]) {
      const fanout = databaseBudget({ DATABASE_POOL_MAX: poolMax }).fanout;
      for (const value of [undefined, "1", "3", "9", "500"]) {
        const limit = managerSyncConcurrency({
          DATABASE_POOL_MAX: poolMax,
          MANAGER_SYNC_LIMIT: value,
        });
        assert.ok(limit >= 1, `pool ${poolMax}, ${value}: admits nobody`);
        assert.ok(limit <= fanout, `pool ${poolMax}, ${value}: ${limit} over ${fanout}`);
      }
    }
  });

  test("falls back rather than failing on junk", () => {
    // A decimal is refused rather than rounded — a fractional permit is a
    // question with no good answer — and a zero or a negative would be an
    // admission that admits nobody, which is an outage rather than a bound.
    const fallback = databaseBudget({}).fanout;
    for (const value of ["", "  ", "lots", "0", "-2", "1.5", "2.9", "NaN", "Infinity"]) {
      assert.equal(
        managerSyncConcurrency({ MANAGER_SYNC_LIMIT: value }),
        fallback,
        value,
      );
    }
  });

  test("reports what was asked for beside what it granted", () => {
    // What the boot-time warning is written from: the clamp is only worth
    // announcing where the two differ.
    const asked = managerSyncLimit({ MANAGER_SYNC_LIMIT: "20" });
    assert.deepEqual(asked, { requested: 20, ceiling: 3, limit: 3 });
    assert.deepEqual(managerSyncLimit({ MANAGER_SYNC_LIMIT: "junk" }), {
      requested: null,
      ceiling: 3,
      limit: 3,
    });
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

  test("a manager stays in flight until its *last* holder releases", () => {
    // The regression the in-flight count replaced a set for. Two cold callers
    // for one manager are both admitted by design — neither has cache to serve —
    // so the key has two holders, and against a set the first of them to finish
    // deleted the entry outright. What that admitted next was not a wasted
    // permit: it was a third caller queueing on the same per-manager advisory
    // lock the second sync is still holding, occupying a pool connection to
    // repeat a fan-out already in flight.
    const admission = createManagerSyncAdmission(3);
    const first = admit(admission, "alice:2026", false);
    const second = admit(admission, "alice:2026", false);
    assert.equal(admission.stats().inFlight, 1, "one manager, two holders");

    first.release();

    const behind = admission.reserve("alice:2026", { dedupe: true });
    assert.equal(behind.ok, false, "the second sync is still running");
    assert.equal(behind.ok === false && behind.reason, "duplicate");
    assert.equal(admission.stats().active, 1, "and the permit it held came back");

    second.release();
    assert.equal(admission.stats().inFlight, 0);
    // Only now is the manager reservable again — and it is, rather than being
    // stuck as a duplicate of a sync nobody is running.
    admit(admission, "alice:2026", true);
  });

  test("the count follows the holders, one release at a time", () => {
    const admission = createManagerSyncAdmission(4);
    const held = [0, 1, 2].map(() => admit(admission, "alice:2026", false));

    for (const [i, reservation] of held.entries()) {
      assert.equal(
        admission.reserve("alice:2026", { dedupe: true }).ok,
        false,
        `still in flight with ${held.length - i} holders`,
      );
      reservation.release();
    }
    assert.equal(admission.stats().inFlight, 0, "and empty once the last goes");
    assert.equal(admission.stats().active, 0, "with every permit back");
  });

  test("one manager in flight is not another manager's duplicate", () => {
    // The count is per key, so a busy manager narrows nothing for anyone else —
    // what bounds *them* is the semaphore, which refuses with `busy` and never
    // with `duplicate`.
    const admission = createManagerSyncAdmission(3);
    admit(admission, "alice:2026", false);
    admit(admission, "alice:2026", false);
    admit(admission, "bob:2026", true);
    assert.equal(admission.stats().inFlight, 2, "two managers, three holders");
  });

  test("a doubled release cannot retire a sibling's registration", () => {
    // The counting makes the idempotence load-bearing in a second way: a
    // `finally` reachable twice would otherwise decrement a key this reservation
    // no longer holds, closing the entry a *live* sync is still registered under
    // and opening the very dedupe window the count exists to keep shut.
    const admission = createManagerSyncAdmission(3);
    const first = admit(admission, "alice:2026", false);
    admit(admission, "alice:2026", false);

    first.release();
    first.release();
    first.release();

    const behind = admission.reserve("alice:2026", { dedupe: true });
    assert.equal(behind.ok, false);
    assert.equal(behind.ok === false && behind.reason, "duplicate");
    assert.equal(admission.stats().active, 1, "and the cap is unwidened");
  });

  test("a thrown sync gives back its own registration and no more", () => {
    // The route releases in a `finally`, so a failure looks like this — and with
    // a sibling sync running under the same key, what it must not do is take
    // that one's registration with it.
    const admission = createManagerSyncAdmission(3);
    const survivor = admit(admission, "alice:2026", false);

    const failing = admit(admission, "alice:2026", false);
    try {
      throw new Error("Sleeper timed out");
    } catch {
      failing.release();
    }

    assert.equal(
      admission.reserve("alice:2026", { dedupe: true }).ok,
      false,
      "the survivor is still syncing this manager",
    );
    survivor.release();
    assert.equal(admission.stats().inFlight, 0, "and nothing is leaked behind it");
    admit(admission, "alice:2026", true);
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
