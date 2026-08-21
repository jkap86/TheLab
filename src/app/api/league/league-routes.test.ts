import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * What each of the four League Details routes is allowed to read.
 *
 * **The one agreement here that nothing else can hold.** A route handler cannot
 * be called in this runner — it opens a pool, awaits `params` and returns a
 * `NextResponse` — so the claim these tests make is about the *source*: which
 * loaders each file names. That is exactly the claim that regresses, because the
 * failure mode of getting it wrong is not an error. A core route that reached
 * for the outlook again would still answer, still typecheck, still pass every
 * other test in the repo, and simply be slow — which is the state this whole
 * split replaced.
 *
 * It is the same shape of test as `trades/sql.test.ts` pinning a sort
 * expression against the migration that indexes it: a fact spanning two files
 * with no compiler link between them, asserted by reading both.
 */

const ROUTES = {
  core: read("[leagueId]/route.ts"),
  values: read("[leagueId]/values/route.ts"),
  outlook: read("[leagueId]/outlook/route.ts"),
  week: read("[leagueId]/week/route.ts"),
} as const;

function read(relative: string): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return readFileSync(`${here}${relative}`, "utf8");
}

/**
 * A call rather than a mention — every one of these names appears in prose in
 * one file or another, and a doc comment explaining why a route *doesn't* read
 * something must not fail the test that says so.
 */
function calls(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*\\(`).test(source);
}

/**
 * Called *or handed over* — a cached read wires its loader in by passing it
 * (`memoizeLeagueOutlook(getLeagueOutlook)`) rather than by calling it, and a
 * doc comment naming it is still not a use.
 */
function wires(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*[(,)]`).test(source);
}

/**
 * The loaders that used to be joined onto the core payload.
 *
 * Two of them are no longer named by a route at all: the outlook and the week
 * are read through the process caches in front of them (`readLeagueOutlook`,
 * `readLeagueWeekView`), which is asserted below rather than only here — a route
 * that went back to calling the loader directly would answer identically and
 * simply do the whole solve again for every tab, reader and revalidation.
 */
const ENRICHMENTS = [
  "getKtcValuesBySleeperId",
  "getDraftAdpForPlayers",
  "getLeagueOutlook",
  "getLeagueWeekView",
  "getLeagueTimeline",
] as const;

/** The reads each enrichment route actually calls — loaders and cached alike. */
const ENRICHMENT_READS = [
  "getKtcValuesBySleeperId",
  "getDraftAdpForPlayers",
  "readLeagueOutlook",
  "readLeagueWeekView",
  "getLeagueTimeline",
] as const;

describe("the core League Details route", () => {
  test("calls none of the enrichment loaders", () => {
    // The whole point of the split: the first paint waits on the structural read
    // and nothing else. Any one of these back in this file puts the panel behind
    // the slowest of four reads again.
    for (const loader of [...ENRICHMENTS, ...ENRICHMENT_READS]) {
      assert.equal(calls(ROUTES.core, loader), false, `core route calls ${loader}`);
    }
  });

  test("returns enough to draw the panel", () => {
    // The fields the standings and roster halves cannot render without: the
    // teams (rosters, records, points for, picks) and the names their player ids
    // resolve to. Asserted as the payload this file actually builds.
    for (const field of [
      "league_id",
      "roster_positions",
      "scoring_settings",
      "settings",
      "best_ball",
      "teams",
      "players",
    ]) {
      // `field:` or the shorthand `field,` — the payload is written both ways.
      assert.match(
        ROUTES.core,
        new RegExp(`\\n\\s+${field}\\s*[:,]`),
        `core payload is missing ${field}`,
      );
    }
    assert.ok(calls(ROUTES.core, "getPlayersByIds"));
  });

  test("it is the only one of the four that stamps demand", () => {
    // Opening a panel is one act of interest however many requests it takes, and
    // the crawler's priority signal is deliberately *observed* — writing it three
    // extra times per open would say nothing new.
    assert.ok(ROUTES.core.includes("stampDemand: true"));
    for (const route of [ROUTES.values, ROUTES.outlook, ROUTES.week]) {
      assert.equal(route.includes("stampDemand"), false);
    }
  });
});

describe("each enrichment route reads its own dataset and no other", () => {
  const OWN: Record<keyof typeof ROUTES, readonly string[]> = {
    core: [],
    values: ["getKtcValuesBySleeperId", "getDraftAdpForPlayers"],
    outlook: ["readLeagueOutlook"],
    week: ["readLeagueWeekView"],
  };

  for (const name of ["values", "outlook", "week"] as const) {
    test(name, () => {
      for (const loader of ENRICHMENT_READS) {
        assert.equal(
          calls(ROUTES[name], loader),
          OWN[name].includes(loader),
          `${name} route and ${loader} disagree`,
        );
      }
    });
  }
});

describe("the two expensive enrichments read through a cache of their own", () => {
  /**
   * The claim only the source can carry, and the one whose failure is silent.
   *
   * `readLeagueDetail` stops four requests from becoming four *league reads*; it
   * does nothing about the work on top of one of them, which is what these two
   * routes cost — ~180ms of lineup solving for the outlook, ~450ms of
   * projections, form averages and solves for the week. A route that called the
   * loader directly again would still answer, still typecheck and still pass
   * every other test here, and would simply run the whole thing once per tab,
   * per reader and per revalidation.
   */
  const CACHED: Record<"outlook" | "week", { loader: string; read: string; module: string }> = {
    outlook: {
      loader: "getLeagueOutlook",
      read: "readLeagueOutlook",
      module: "../../../shared/projections/outlook-read.ts",
    },
    week: {
      loader: "getLeagueWeekView",
      read: "readLeagueWeekView",
      module: "../../../shared/stats/week-read.ts",
    },
  };

  for (const [name, { loader, read: reader, module }] of Object.entries(CACHED)) {
    test(`${name} goes through ${reader}, never the loader`, () => {
      assert.ok(calls(ROUTES[name as "outlook" | "week"], reader));
      assert.equal(calls(ROUTES[name as "outlook" | "week"], loader), false);
      // The other end of it: the cached read is where the loader is named, so
      // the pair cannot drift into a wrapper that wraps nothing.
      assert.ok(wires(read(module), loader), `${module} does not read ${loader}`);
    });
  }
});

describe("the league → ADP-board lookup", () => {
  test("is not re-queried by the values route", () => {
    // `getLeagueAdpBoards([leagueId])` asked `leagues` which market one league
    // plays in — a fact the league read this route already makes had selected and
    // then dropped. Carried out as `LeagueDetail.league_type`, so the board type
    // is a pure derivation over something in hand.
    assert.equal(calls(ROUTES.values, "getLeagueAdpBoards"), false);
    assert.ok(calls(ROUTES.values, "adpBoardTypeOf"));
    assert.ok(ROUTES.values.includes("detail.league_type"));
  });
});

describe("an enrichment that fails says so", () => {
  /**
   * The rule the source is the only place to assert.
   *
   * `…/week` and `…/outlook` each caught their read and returned `null`, which
   * the route then sent with a 200 — so a database timeout arrived at the browser
   * as a successful answer holding nothing, indistinguishable from a league that
   * genuinely has no outlook, never retried, and cached as an answer for the
   * entry's whole stale time. What the response *is* in each case is asserted for
   * real in `read-response.test.ts`; what cannot be asserted there is that these
   * two files still go through it, because a route that quietly went back to
   * catching its own read would pass every other test in the repo.
   */
  for (const name of ["outlook", "week"] as const) {
    test(`${name} routes its failures through the shared helper`, () => {
      assert.ok(calls(ROUTES[name], "readResponse"), `${name} route bypasses readResponse`);
    });

    test(`${name} does not turn a failure back into a body`, () => {
      // The swallow's exact shape: a `.catch` in the route file whose handler
      // hands back a null for the response to carry. Neither file has any
      // business catching its own read now — the helper does it — so the tell
      // is asserted rather than the wording of any one spelling of it.
      assert.equal(
        /\.catch\(/.test(ROUTES[name]),
        false,
        `${name} route catches its own read`,
      );
      // A statement, not the word: `calls` already exists because every name
      // here also appears in prose, and these files' doc comments now argue
      // about exactly this.
      assert.equal(
        /\breturn null\s*;/.test(ROUTES[name]),
        false,
        `${name} route can still answer null from its own code`,
      );
    });
  }

  test("the helper answers a failure with the read-failure response", () => {
    // The other end of it: `readResponse` is only worth routing through because
    // it defers to the one policy that tells a busy database (503, retry) from a
    // broken read (500). A copy of that decision inside it would be the parallel
    // implementation this is meant to prevent.
    const helper = read("../read-response.ts");
    assert.ok(calls(helper, "readFailureResponse"));
    assert.equal(/\breturn null\s*;/.test(helper), false);
  });

  test("the week route's serialiser has no null branch left", () => {
    // `getLeagueWeekView` is `Promise<LeagueWeekView>`, so a null-taking
    // serialiser was the seam a caught exception came back through. Typed to the
    // view alone, there is nowhere for one to re-enter.
    assert.match(ROUTES.week, /function serializeWeekView\(view: LeagueWeekView\)/);
  });
});

describe("the values route's two lenses fail apart, and say so", () => {
  /**
   * The same rule as the block above, arrived at from the other side.
   *
   * `…/outlook` and `…/week` were a route-level swallow — the *whole* answer
   * came back null. This one is a swallow per *lens*: each read was caught into
   * the empty form of its own dataset, which is exactly what a roster of kickers
   * and rookies legitimately produces. So a KTC outage arrived as "nothing on
   * this roster is priced", cached for the panel's whole stale time with no
   * layer able to tell.
   *
   * The partial-success half is deliberately unchanged and is what keeps this
   * route from going through `readResponse` like its two siblings: one lens
   * failing must still leave the other's numbers on screen. What is asserted
   * here is that the guard now *reports* rather than fabricates.
   */
  test("each lens is guarded through readOptional, not a bare catch", () => {
    assert.ok(calls(ROUTES.values, "readOptional"));
    assert.equal(
      /\.catch\(/.test(ROUTES.values),
      false,
      "values route still catches a lens into an empty answer",
    );
  });

  test("both statuses reach the payload", () => {
    // Separately, because the two are separate facts: a reader is told which
    // column is blank, not merely that something is.
    assert.match(ROUTES.values, /\n\s+ktc_status:\s*ktcRead\.status/);
    assert.match(ROUTES.values, /\n\s+adp_status:\s*adpRead\.status/);
  });

  test("neither lens is fatal to the other", () => {
    // The join is still a join: `readOptional` never rejects, so one lens
    // falling over cannot make this `Promise.all` fail-fast.
    assert.match(ROUTES.values, /Promise\.all\(\[/);
  });
});

describe("the four routes share one league read", () => {
  test("every one of them resolves through the cached helper", () => {
    // A split that ran `getLeagueDetail` four times would have traded blocking
    // for load. `resolveLeagueRequest` reads through `readLeagueDetail`, which is
    // TTL'd and coalesced, so one open costs one league read.
    for (const route of Object.values(ROUTES)) {
      assert.ok(calls(route, "resolveLeagueRequest"));
      assert.equal(calls(route, "getLeagueDetail"), false);
    }
    assert.ok(calls(read("[leagueId]/league-request.ts"), "readLeagueDetail"));
  });
});
