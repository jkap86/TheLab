import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * How the three manager routes that carry an **optional** section report it.
 *
 * The same shape of claim `league-routes.test.ts` makes about its four: a route
 * handler cannot be called in this runner — it opens a pool, awaits `params` and
 * returns a `NextResponse` — so what is asserted is the *source*. That is the
 * right level for this one, because the failure being prevented has no error and
 * no wrong-looking number: a `.catch(() => null)` around a lineup solve reads as
 * a league with nothing left to project, answers, typechecks, and passes every
 * other test in the repo.
 *
 * The behaviour behind these names is asserted where it can be run —
 * `shared/util/optional-read.test.ts` for what `readOptional` returns,
 * `shared/manager/ranks-read.test.ts` for what a failed projections read does to
 * a cached payload, and `features/shared/degraded-cache.test.ts` for what the
 * browser then does with it. What none of those can say is that these three
 * files still go through any of it.
 */

const ROUTES = {
  ktc: read("[username]/ktc/route.ts"),
  adpValue: read("[username]/adp-value/route.ts"),
  matchups: read("[username]/matchups/route.ts"),
  ranks: read("[username]/ranks/route.ts"),
} as const;

function read(relative: string): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return readFileSync(`${here}${relative}`, "utf8");
}

/** A call rather than a mention — every one of these names appears in prose. */
function calls(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*\\(`).test(source);
}

describe("the two value routes' lineup solve", () => {
  for (const name of ["ktc", "adpValue"] as const) {
    test(`${name} guards it through readOptional`, () => {
      assert.ok(calls(ROUTES[name], "readOptional"));
    });

    test(`${name} no longer catches it into a bare null`, () => {
      // The exact swallow this replaces. A null lineup set is what a league with
      // no slots or scoring on file legitimately produces, so a failed solve was
      // indistinguishable from one — and the browser held it as a fresh success
      // for a quarter of an hour.
      assert.equal(
        /\.catch\(/.test(ROUTES[name]),
        false,
        `${name} route still catches its own optional read`,
      );
      assert.equal(
        /\breturn null\s*;/.test(ROUTES[name]),
        false,
        `${name} route can still fabricate an empty solve`,
      );
    });

    test(`${name} puts the solve's status on the payload`, () => {
      assert.match(ROUTES[name], /\n\s+lineups:\s*lineups\.status/);
    });

    test(`${name} keeps its prices unguarded`, () => {
      // The other half of "decide per read": a read the payload *is* must fail
      // as a failure. Exactly one `readOptional` in each file, so the guard
      // cannot have crept onto the read that carries the answer.
      assert.equal(ROUTES[name].match(/readOptional\(/g)?.length, 1);
      assert.ok(calls(ROUTES[name], "readFailureResponse"));
    });
  }
});

describe("the lineup checker's week", () => {
  test("is guarded through readOptional and reported", () => {
    assert.ok(calls(ROUTES.matchups, "readOptional"));
    assert.match(ROUTES.matchups, /\n\s+projections:\s*solved\.status/);
  });

  test("no longer fabricates an empty league map inside a catch", () => {
    // `{ week, teams: new Map() }` is still the degraded shape — it is what the
    // rest of the route reads — but it is reached through a status now, not
    // conjured inside a `.catch` where nothing downstream could tell.
    assert.equal(
      /\.catch\(/.test(ROUTES.matchups),
      false,
      "matchups route still catches its own solve",
    );
  });

  test("a season with no week ahead is an answer, not a failure", () => {
    // The one place `"ok"` is written by hand: there was no week to solve, so
    // nothing failed and nothing should be retried.
    assert.match(ROUTES.matchups, /week: null,\n\s+projections: "ok",/);
  });
});

describe("the ranks route", () => {
  test("still holds no failure policy of its own", () => {
    // Everything above the response is `readManagerRanks`, cache included — the
    // status this payload carries is decided there, and a route that started
    // catching its own read would be the second place that decision lives.
    assert.ok(calls(ROUTES.ranks, "readManagerRanks"));
    assert.equal(/\.catch\(/.test(ROUTES.ranks), false);
    assert.equal(calls(ROUTES.ranks, "getWeeklyTeamPoints"), false);
  });
});
