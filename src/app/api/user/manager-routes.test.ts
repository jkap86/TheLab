import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * That the three lenses of a default Manager load read through the shared
 * snapshot, and that their contracts did not move while they were being pointed
 * at it.
 *
 * **The claim nothing else can hold.** A route handler cannot be called in this
 * runner — it opens a pool, awaits `params` and returns a `NextResponse` — so
 * this is a claim about the *source*: which reads each file names. That is
 * exactly the claim that regresses here, because the failure mode of getting it
 * wrong is not an error. A route that went back to `getManagerLeagueRosters` and
 * `getOptimalLineups` would answer identically, typecheck, and pass every other
 * test in the repo, while quietly doing the whole account's reads and the whole
 * account's lineup solve over again for every lens the reader has switched on.
 *
 * `league-routes.test.ts` is the same shape of test one tool along, and this
 * borrows its two helpers: every one of these names appears in prose in one file
 * or another, so a mention is not a use.
 */

const ROUTES = {
  ranks: read("[username]/ranks/route.ts"),
  ktc: read("[username]/ktc/route.ts"),
  adpValue: read("[username]/adp-value/route.ts"),
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

/** A call rather than a mention — a doc comment naming a read is not a read. */
function calls(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*\\(`).test(source);
}

/** Called *or handed over*, since a memoiser wires its loader in by passing it. */
function wires(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*[(,)]`).test(source);
}

/**
 * The reads that used to be made once per lens.
 *
 * Both are still exported and still correct — `getManagerLeagueRosters` is the
 * loader behind the snapshot and the lineup checker's own route reads it, and
 * `getOptimalLineups` is what the snapshot solves with. What must not come back
 * is a *Manager batch lens* calling either for itself.
 */
const UNSHARED_READS = ["getManagerLeagueRosters", "getOptimalLineups"] as const;

describe("the three lenses of a default Manager load", () => {
  test("none of them reads the roster graph or solves lineups for itself", () => {
    for (const [name, source] of Object.entries(ROUTES)) {
      for (const unshared of UNSHARED_READS) {
        assert.equal(
          calls(source, unshared),
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
