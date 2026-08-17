import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  compareWeekAttempts,
  HORIZON_ORDER_SQL,
  orderWeeksByAttempt,
  WEEK_ORDER_SQL,
} from "./horizon-queue.ts";

/**
 * The horizon pass is a cap over a stale list, so what sits at the head of that
 * list is the whole behaviour. Ordering it by week number let a week that never
 * stamps — one that fails to fetch, or whose payload the completeness gate
 * refuses — hold the head of it on every tick forever, and two of those are the
 * entire cap. What that looks like from outside is a season whose projections
 * stop at week 2 while the loop reports itself healthy.
 */

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

/**
 * `sync.HORIZON_WEEKS_PER_TICK`, spelled again rather than imported: `./sync`
 * pulls in `pg`, and a module under test has to be resolvable by the runner. It
 * is the *shape* of the pass being asserted here, so the two drifting apart
 * costs this test nothing it was checking.
 */
const CAP = 4;

const untried = (week: number) => ({ week, attemptAtMs: null });
const tried = (week: number, agoMs: number) => ({
  week,
  attemptAtMs: NOW - agoMs,
});

const weeksOf = (list: { week: number }[]) => list.map((w) => w.week);

describe("compareWeekAttempts", () => {
  test("a cold horizon still walks in week order", () => {
    // The common case, and the one that must not change: nothing has been tried,
    // so the tiebreaker is all there is and the pass runs 3,4 → 5,6 → … exactly
    // as it did before any of this existed.
    const cold = [3, 4, 5, 6, 7, 8].map(untried);
    assert.deepEqual(weeksOf(orderWeeksByAttempt(cold)), [3, 4, 5, 6, 7, 8]);
  });

  test("a week never tried outranks one that has been", () => {
    // Even when the tried one was tried a very long time ago, and even when it
    // is the lower week number — untried is the tier, not a tiebreak.
    assert.equal(compareWeekAttempts(untried(18), tried(3, 365 * 24 * HOUR)) < 0, true);
    assert.equal(compareWeekAttempts(tried(3, 365 * 24 * HOUR), untried(18)) > 0, true);
  });

  test("among tried weeks the longest-since-tried goes first", () => {
    const rotated = orderWeeksByAttempt([
      tried(3, 1 * HOUR),
      tried(18, 9 * HOUR),
      tried(7, 5 * HOUR),
    ]);
    assert.deepEqual(weeksOf(rotated), [18, 7, 3]);
  });

  test("week number breaks a tie between equal attempts", () => {
    // Every week a pass stamps is stamped within the same tick, so ties are the
    // normal case rather than an edge one — without the tiebreaker the order
    // inside a pass would be whatever the plan happened to emit.
    const sameTick = [7, 3, 18, 5].map((w) => tried(w, 2 * HOUR));
    assert.deepEqual(weeksOf(orderWeeksByAttempt(sameTick)), [3, 5, 7, 18]);
  });

  test("a failing week gives way instead of consuming the cap", () => {
    // The regression, spelled as the pass it broke. Weeks 3 and 4 fail on every
    // tick, so they carry a stamp and the fourteen weeks behind them do not.
    const stale = [
      tried(3, 15 * 60 * 1000),
      tried(4, 15 * 60 * 1000),
      ...[5, 6, 7, 8, 9, 10].map(untried),
    ];
    const pass = orderWeeksByAttempt(stale).slice(0, CAP);

    assert.deepEqual(
      weeksOf(pass),
      [5, 6, 7, 8],
      "a week that never succeeds must not hold the head of the queue",
    );
  });

  test("a failing week is retried once the untried weeks are exhausted", () => {
    // The other half: rotating must not become dropping. Once everything has
    // had a turn, the oldest attempt is the failing week and it comes back
    // around — the eagerness a missing freshness stamp buys is intact, it has
    // just stopped being exclusive.
    const stale = [tried(3, 90 * 60 * 1000), tried(4, 30 * 60 * 1000)];
    assert.deepEqual(weeksOf(orderWeeksByAttempt(stale)), [3, 4]);
  });

  test("the sort does not mutate the list it is given", () => {
    const stale = [tried(9, HOUR), untried(3)];
    orderWeeksByAttempt(stale);
    assert.deepEqual(weeksOf(stale), [9, 3]);
  });
});

describe("the SQL spells the same rule as the comparator", () => {
  test("the horizon fragment orders on the attempt, nulls first", () => {
    // A matched pair with no compiler link: `staleWeeks` runs the fragment and
    // the tests drive the function, so the agreement is only ever asserted
    // here. `NULLS FIRST` is the load-bearing half — it is *not* the default for
    // an ascending sort, so dropping it silently sends every untried week to the
    // back and the cold horizon never fills at all.
    assert.match(HORIZON_ORDER_SQL, /attempt_at\s+NULLS FIRST/);
    assert.match(HORIZON_ORDER_SQL, /w\.week\s*$/);
    assert.equal(compareWeekAttempts(untried(18), tried(3, HOUR)) < 0, true);
  });

  test("the uncapped fragment orders on the week alone", () => {
    // The near window is two weeks and both are always fetched, so rotating them
    // buys nothing. A fragment that named `attempt_at` here would be reading a
    // column the near window has no use for.
    assert.equal(WEEK_ORDER_SQL, "w.week");
    assert.ok(!WEEK_ORDER_SQL.includes("attempt_at"));
  });

  test("neither fragment reads attempt_at as freshness", () => {
    // `attempt_at` orders and never gates. Spelled as a comparison against
    // `now()` it would let a week wait out a whole TTL on the strength of having
    // failed, which is the opposite of what stamping the attempt is for.
    for (const fragment of [HORIZON_ORDER_SQL, WEEK_ORDER_SQL]) {
      assert.ok(!/now\s*\(/i.test(fragment));
      assert.ok(!/interval/i.test(fragment));
    }
  });

  test("the column the ordering reads is the one a migration adds", () => {
    // No type carries this and the failure is silent in the worst way: an
    // `ORDER BY` naming a column that isn't there errors the whole freshness
    // query, so every tick fails and the sync stops rather than slowing down.
    const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
    const file = readdirSync(dir).find((n) =>
      n.includes("projection_week_attempt"),
    );
    assert.ok(file, "the projections attempt-stamp migration is still there");

    const migration = readFileSync(join(dir, file), "utf8").toLowerCase();
    assert.ok(migration.includes("add column if not exists attempt_at"));
    // `synced_at` has to be able to say "never", or an attempt-only insert
    // stamps the week fresh for its whole TTL for having failed.
    assert.ok(migration.includes("alter column synced_at drop not null"));
    assert.ok(migration.includes("alter column synced_at drop default"));
  });
});
