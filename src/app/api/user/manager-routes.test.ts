import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * How the manager routes that carry an **optional** section report it, and that
 * the three lenses of a default Manager load read through the shared snapshot.
 *
 * Two claims in one file because they are the same claim about the same four
 * sources: what each route *names*. One says a failed read is reported rather
 * than swallowed; the other says the expensive reads behind three lenses are
 * made once between them rather than once each.
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
 * browser then does with it. The sharing behind the second claim is asserted the
 * same way — `shared/manager/snapshot-cache.test.ts` counts what a memoiser asks
 * of its loaders and `shared/manager/manager-snapshot.test.ts` counts what the
 * real reads ask of `pool`. What none of those can say is that these files still
 * go through any of it.
 *
 * Both failures are silent by construction. A `.catch(() => null)` around a
 * lineup solve reads as a league with nothing left to project; a route that went
 * back to `getManagerLeagueRosters` and `getOptimalLineups` answers identically
 * and simply does the whole account's reads and the whole account's lineup solve
 * again for every lens the reader has switched on. Both answer, both typecheck,
 * and both pass every other test in the repo.
 */

const ROUTES = {
  ktc: read("[username]/ktc/route.ts"),
  adpValue: read("[username]/adp-value/route.ts"),
  matchups: read("[username]/matchups/route.ts"),
  ranks: read("[username]/ranks/route.ts"),
} as const;

/** The domain module the ranks route reads through, rather than at. */
const RANKS_READ = readShared("manager/ranks-read.ts");

function read(relative: string): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return readFileSync(`${here}${relative}`, "utf8");
}

function readShared(relative: string): string {
  const here = fileURLToPath(new URL("../../../shared/", import.meta.url));
  return readFileSync(`${here}${relative}`, "utf8");
}

/** A call rather than a mention — every one of these names appears in prose. */
function calls(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*\\(`).test(source);
}

/** Called *or handed over*, since a memoiser wires its loader in by passing it. */
function wires(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*[(,)]`).test(source);
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

/**
 * The reads that used to be made once per lens.
 *
 * Both are still exported and still correct — `getManagerLeagueRosters` is the
 * loader behind the snapshot and the lineup checker's own route reads it
 * directly, and `getOptimalLineups` is what the snapshot solves with. What must
 * not come back is a *Manager batch lens* calling either for itself.
 */
const UNSHARED_READS = ["getManagerLeagueRosters", "getOptimalLineups"] as const;

/** The three requests a default Manager load fires together. */
const LENSES = ["ranks", "ktc", "adpValue"] as const;

describe("the three lenses of a default Manager load", () => {
  test("none of them reads the roster graph or solves lineups for itself", () => {
    for (const name of LENSES) {
      for (const unshared of UNSHARED_READS) {
        assert.equal(
          calls(ROUTES[name], unshared),
          false,
          `${name} calls ${unshared} rather than reading the shared snapshot`,
        );
      }
    }
  });

  test("the two value lenses read the shared snapshot", () => {
    for (const name of ["ktc", "adpValue"] as const) {
      assert.ok(
        calls(ROUTES[name], "readManagerSnapshot"),
        `${name} reads the shared roster snapshot`,
      );
    }
  });

  test("and share one lineup solve between them", () => {
    // The whole point of the pair: a starter value is a sum over whoever starts,
    // and neither lens has any say in who that is. Two calls to
    // `getOptimalLineups` were two copies of the same solve.
    for (const name of ["ktc", "adpValue"] as const) {
      assert.ok(
        calls(ROUTES[name], "readManagerOptimalLineups"),
        `${name} reads the shared aggregate lineups`,
      );
    }
  });

  test("the projected ranks read through their own cache, which reads the snapshot", () => {
    // The ranks are cached and coalesced a layer up (`readManagerRanks`), so the
    // route names that and the domain module names the snapshot.
    assert.ok(calls(ROUTES.ranks, "readManagerRanks"));
    assert.ok(wires(RANKS_READ, "readManagerSnapshot"));
    assert.ok(wires(RANKS_READ, "readManagerProjectionInputs"));
  });

  test("the ranks keep their own weekly solves", () => {
    // Sharing the *reads* is the point; sharing the answer is not. A weekly
    // total is one lineup per team per week, and handing the ranks the aggregate
    // lineup to widen the reuse would change the number they report.
    assert.ok(calls(RANKS_READ, "getWeeklyTeamPoints"));
    assert.equal(calls(RANKS_READ, "readManagerOptimalLineups"), false);
  });

  test("the shared solve is still the guarded, optional one", () => {
    // The two claims meeting: sharing a read must not quietly make it fatal.
    for (const name of ["ktc", "adpValue"] as const) {
      assert.match(
        ROUTES[name],
        /readOptional\(\s*`\[[a-z-]+\] lineups for \$\{username\}`,\s*\(\) =>\s*readManagerOptimalLineups\(/,
        `${name} still reports a failed shared solve rather than swallowing it`,
      );
    }
  });
});

describe("the payloads on the wire", () => {
  /** Each lens, its contract type, and the methods it answers. */
  const CONTRACTS = [
    { name: "ranks", type: "ManagerRanksPayload", methods: ["GET"] },
    { name: "ktc", type: "ManagerKtcPayload", methods: ["GET"] },
    {
      name: "adpValue",
      type: "ManagerAdpValuePayload",
      // A read answering a POST, because the drawer's league scope is a list of
      // ids a request line cannot carry — see the route.
      methods: ["GET", "POST"],
    },
  ] as const;

  test("are still the contract types, declared in `shared/contract`", () => {
    for (const { name, type } of CONTRACTS) {
      assert.ok(
        new RegExp(`import type \\{[^}]*\\b${type}\\b`, "s").test(ROUTES[name]),
        `${name} annotates its response with ${type}`,
      );
      assert.ok(
        /from "@\/shared\/contract"/.test(ROUTES[name]),
        `${name} takes it from the one contract module`,
      );
    }
  });

  test("are answered on the same methods", () => {
    for (const { name, methods } of CONTRACTS) {
      const exported = [...ROUTES[name].matchAll(/export async function (\w+)\(/g)]
        .map((match) => match[1])
        .filter((fn) => fn === fn.toUpperCase());
      assert.deepEqual(exported, [...methods], `${name} answers ${methods.join("/")}`);
    }
  });
});
