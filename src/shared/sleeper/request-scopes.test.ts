import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, test } from "node:test";

/**
 * Where the two request classes are declared, pinned against their source.
 *
 * **This is `crawl-writes.test.ts`'s bargain, for its reason.** Every module
 * named here imports `@/shared/…`, which Node's own runner cannot resolve, so
 * the composition tests one folder over can prove that a *policy* reaches the
 * limiter and the ladder and cannot prove that any real caller declares one.
 * And the declaration is exactly the kind of fact nothing fails over:
 *
 * - a route that lost its interactive scope is as slow as it was before this
 *   work, answering eventually to a browser that gave up thirty seconds ago;
 * - a **durable** path that lost its background scope starts shedding leagues
 *   to a four-second queue budget under precisely the crawler pressure it is
 *   queued behind — having already stamped `sync_attempt_at` — and lets one
 *   browser navigating away abandon a fan-out whose answer is rows every other
 *   reader shares.
 *
 * Neither throws. Both render a perfectly ordinary page. So the scopes are
 * asserted textually, and an edit that removes one has to delete a line saying
 * why it was there.
 */

const read = (...segments: string[]) =>
  readFileSync(join(process.cwd(), ...segments), "utf8");

/**
 * Durable work: shared state written into Postgres, started from inside a
 * request and outliving it.
 *
 * Each of these opens its own scope rather than trusting its callers, which is
 * the only arrangement that cannot be forgotten at a call site — and each is
 * reached from a route handler that has declared itself interactive, so the
 * scope is doing real work rather than restating a default.
 */
const DURABLE: [file: string[], fn: string, why: string][] = [
  [
    ["src", "shared", "manager", "sync.ts"],
    "syncManagerLeagues",
    "a manager's whole league graph, under an advisory lock held across it",
  ],
  [
    ["src", "shared", "manager", "league-refresh.ts"],
    "refreshLeague",
    "one league re-read and rewritten, on a cooldown it has already stamped",
  ],
  [
    ["src", "shared", "manager", "league-history.ts"],
    "extendLeagueHistory",
    "an earlier season fetched into the shared corpus",
  ],
];

describe("durable work declares the background budget itself", () => {
  for (const [file, fn, why] of DURABLE) {
    test(`${fn} — ${why}`, () => {
      const source = read(...file);
      const start = source.indexOf(`export async function ${fn}(`);
      assert.notEqual(start, -1, `${fn} should be exported`);
      const end = source.indexOf("\n}", start);
      assert.notEqual(end, -1, `${fn} should be terminated`);
      const declaration = source.slice(start, end);

      assert.match(
        declaration,
        /withBackgroundSleeper\(/,
        `${fn} must open a background scope: it is reached from an interactive route`,
      );
      // The scope is the *whole* of the exported function rather than something
      // deeper in it: a scope opened around one read leaves every other read of
      // the same run on the reader's budget.
      assert.ok(
        declaration.split("withBackgroundSleeper(").length === 2,
        `${fn} should open exactly one scope, around all of its work`,
      );
    });
  }
});

describe("the long-lived rooms tick as background traffic", () => {
  // Both are *opened* from a request — a reader joining is what creates them —
  // and both outlive that reader by design. The read that opens a room is also
  // what arms its timer chain, so a room opened inside an interactive scope
  // would carry that reader's budget and their signal for the life of the room.
  const rooms: [file: string[], name: string][] = [
    [["src", "shared", "picktracker", "live.ts"], "the picktracker draft room"],
  ];

  for (const [file, name] of rooms) {
    test(`${name} declares it on the open and on every tick`, () => {
      const source = read(...file);
      const scopes = source.split("withBackgroundSleeper(").length - 1;
      assert.ok(
        scopes >= 2,
        `${name} should declare the class where it opens and where it ticks`,
      );
    });
  }

  test("the gametime week room declares it once, in front of its only path to Sleeper", () => {
    // That room takes its feed reader as an argument (`gametime/live-room`) so
    // its timer chain can be driven under Node's runner, and the wiring is
    // where the real reader is named — wrapped there, one declaration covers
    // the read that opens a room and every tick after it. What has to hold
    // for that to be the whole story is that the room reaches Sleeper no
    // other way.
    const wiring = read("src", "shared", "gametime", "live.ts");
    assert.match(
      wiring,
      /readFeeds: \(season, week\) => withBackgroundSleeper\(\(\) => readWeekFeeds\(season, week\)\)/,
      "the wiring should hand the room a background-scoped feed reader",
    );
    const room = read("src", "shared", "gametime", "live-room.ts");
    // No runtime import of anything that reaches Sleeper — a type import is
    // erased before the runner sees it, and is allowed.
    assert.doesNotMatch(
      room,
      /^import (?!type ).*from "(?:@\/shared\/(?:sleeper|projections|manager)|\.\/feeds)/m,
    );
    assert.doesNotMatch(room, /readWeekFeeds\(/);
    assert.match(room, /deps\.readFeeds\(/);
  });
});

describe("every background loop ticks as background traffic", () => {
  test("the shared loop helper declares it once for all four loops", () => {
    // The KTC scrape, the players map, the crawl and the comps corpus all run
    // through `startBackgroundLoop`, so this is one line covering four loops —
    // and it is what stops a loop *started* from a request path inheriting that
    // reader's budget for the life of the process.
    const source = read("src", "shared", "util", "background-loop.ts");
    assert.match(source, /withBackgroundSleeper\(\(\) => tick\(firstRun\)\)/);
  });
});

/**
 * Every `route.ts` under `src/app`, found rather than listed.
 *
 * **The list was the hole.** The routes were enumerated by hand, so the failure
 * this suite exists to catch — somebody adds a Sleeper-backed route and forgets
 * the scope — was caught only if the same somebody also remembered to add it
 * here, which is the thing they had just forgotten to do. A route nobody listed
 * passed by not being looked at.
 */
function routeFiles(dir = join(process.cwd(), "src", "app")): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(path));
    else if (entry.name === "route.ts") found.push(path);
  }
  return found.sort();
}

/** A repo-relative path, so a failure names the file the way a reader would. */
const relative = (path: string) =>
  path.slice(process.cwd().length + 1).split(sep).join("/");

/**
 * The names that reach `sleeperGet`, directly or a few modules down.
 *
 * Deliberately a list of *readers* rather than a transitive import walk: what
 * matters is whether a handler can end up queueing on the Sleeper limiter, and
 * these are the doors to it. A compiler-grade reachability analysis would catch
 * more and would be a second build system to maintain; this catches the case
 * that actually happens, which is a new handler calling one of these by name.
 *
 * The last four are the client itself, for a route that skips the helpers and
 * fetches Sleeper directly — the shape a future route is most likely to take
 * and the one a list of helper names would miss.
 */
const SLEEPER_DOORS = [
  "getActiveSeason",
  "resolveManagerUser",
  "getNflState",
  "currentWeek",
  "restOfSeasonStart",
  "getRosProjections",
  "getWeekProjections",
  "getWeekStats",
  "getWeekGames",
  "getWeekKickoffs",
  "getWeekGameClocks",
  "getNflWeekScores",
  "trackPlaceholderDraft",
  "readWeekFeeds",
  "syncManagerLeagues",
  "getAllPlayers",
  "getSleeperUser",
  "sleeperGet",
  "sleeperGetOptional",
];

/**
 * A route may reach Sleeper and still not open a scope, but only on purpose and
 * only with the reason written down here.
 *
 * Keyed by repo-relative path, so an exemption for a route that is later
 * deleted or renamed fails as a stale entry rather than quietly covering
 * nothing. Empty today, which is the honest state: every Sleeper-backed route
 * in this app answers a reader.
 */
const EXEMPT: Record<string, string> = {};

/** Which doors a source names, for the failure message. */
const doorsIn = (source: string): string[] =>
  SLEEPER_DOORS.filter((name) =>
    new RegExp(`\\b${name}\\b`).test(source),
  );

describe("every route that reaches Sleeper declares the interactive budget", () => {
  const routes = routeFiles();

  test("there are routes to check at all", () => {
    // A discovery that silently found nothing would make every assertion below
    // vacuous, which is the one way an automatic list is worse than a hand one.
    assert.ok(routes.length >= 15, `found ${routes.length} route files`);
  });

  for (const path of routes) {
    const name = relative(path);
    test(name, () => {
      const source = readFileSync(path, "utf8");
      const doors = doorsIn(source);
      if (doors.length === 0) return;

      if (name in EXEMPT) {
        assert.ok(
          EXEMPT[name].length > 0,
          `${name} is exempt and must say why`,
        );
        return;
      }

      // `interactiveRoute` is the route-shaped composition of
      // `withInteractiveSleeper` — it opens the same scope and turns an
      // admission refusal into a 503 — and is what a handler should reach for;
      // the bare scope is accepted because a route that streams or that is not
      // answering with a `Response` may legitimately want it.
      assert.match(
        source,
        /interactiveRoute\(|withInteractiveSleeper\(/,
        `${name} reaches Sleeper (${doors.join(", ")}) and must declare the ` +
          `interactive budget, or be listed in EXEMPT with a reason`,
      );
    });
  }

  test("no exemption names a route that is gone", () => {
    const names = new Set(routes.map(relative));
    for (const exempt of Object.keys(EXEMPT)) {
      assert.ok(names.has(exempt), `EXEMPT names ${exempt}, which is not a route`);
    }
  });

  test("no exemption names a route that no longer reaches Sleeper", () => {
    for (const [exempt, why] of Object.entries(EXEMPT)) {
      const source = readFileSync(join(process.cwd(), ...exempt.split("/")), "utf8");
      assert.ok(
        doorsIn(source).length > 0,
        `EXEMPT names ${exempt} ("${why}"), which reaches Sleeper no more`,
      );
    }
  });
});

describe("a page that reaches Sleeper declares it too", () => {
  // Pages are not discovered: there are dozens of them, nearly all of which
  // read Postgres or nothing at all, and a walk of every `page.tsx` for one
  // caller is a slow test that says little. This is the one, and it is listed
  // so that its scope cannot be dropped in passing.
  test("src/app/trades/page.tsx", () => {
    const source = read("src", "app", "trades", "page.tsx");
    assert.match(source, /getActiveSeason/);
    assert.match(source, /withInteractiveSleeper\(/);
  });
});

describe("the interactive budget is a request's, not a read's", () => {
  test("the route scope is the one place a handler's overload is answered", () => {
    // Nothing under test here can be reached by Node's runner — the module
    // imports `@/shared/sleeper` — so what is pinned is that the composition
    // still does both of its jobs. A version that opened the scope and dropped
    // the mapping would leave every route's `resolveManagerUser` and
    // `getActiveSeason` — both of which run *before* the handler's own `try` —
    // reaching Next as an unhandled exception.
    const source = read("src", "shared", "api", "interactive-route.ts");
    assert.match(source, /withInteractiveSleeper\(/);
    assert.match(source, /mapOverload\(/);
    // And rethrows anything else, which is what makes it safe in front of every
    // route: a handler's own 500s are untouched.
    assert.match(source, /throw error;/);
  });

  test("the interactive scope mints one deadline for the whole request", () => {
    // The invariant in one line of source: a scope that read
    // `INTERACTIVE_SLEEPER_POLICY` without stamping an `expiresAt` would give
    // every read in a handler its own twelve seconds, which is the state this
    // work exists to leave. Driven properly in `request-policy.test.ts`; pinned
    // here because it is the line a later edit is most likely to simplify away.
    const source = read("src", "shared", "sleeper", "request-policy.ts");
    const start = source.indexOf("export function withInteractiveSleeper<T>(");
    assert.notEqual(start, -1);
    const scope = source.slice(start, source.indexOf("\n}", start));
    // Minted from a whole-request budget rather than from the per-ladder one…
    assert.match(scope, /INTERACTIVE_REQUEST_BUDGET_MS/);
    // …stamped onto the policy every read under it resolves against…
    assert.match(scope, /expiresAt/);
    // …and *inherited* where one is already in force, so a handler that wraps
    // twice does not get two budgets.
    assert.match(scope, /ambient\.expiresAt/);
  });
});

describe("a shared Sleeper read is produced by nobody in particular", () => {
  /**
   * The in-process caches that hold a *promise* rather than an answer.
   *
   * Each is a fetch several callers join, so each has to do two things that no
   * test outside this file can check: populate itself inside a background scope
   * (so neither class chooses the other's ladder, and no reader's disconnect
   * rejects a board other readers hold) and hand its promise over through
   * `awaitShared` (so each caller waits only as long as its own request has
   * left). Both are silent when wrong — the page is slow and the loop is thin,
   * and every module involved is doing what it says.
   */
  const CACHES: [file: string[], what: string][] = [
    [["src", "shared", "sleeper", "state.ts"], "the NFL state"],
    [["src", "shared", "projections", "week-read.ts"], "a week's projections"],
    [["src", "shared", "projections", "week-stats-read.ts"], "a week's stats"],
    [["src", "shared", "projections", "ros-read.ts"], "the rest-of-season span"],
    [["src", "shared", "schedule", "live.ts"], "the live scoreboard"],
    [["src", "shared", "season", "index.ts"], "the active season"],
  ];

  for (const [file, what] of CACHES) {
    test(`${what} — a background producer and a bounded waiter`, () => {
      const source = read(...file);
      assert.match(
        source,
        /withBackgroundSleeper\(/,
        `${what} is shared, so the fetch behind it must belong to nobody`,
      );
      assert.match(
        source,
        /awaitShared\(/,
        `${what} is shared, so every caller must bound its own wait`,
      );
    });
  }

  test("the manager lookup bounds its waiters and says why it keeps its producer", () => {
    // The one deliberate exception, and the reason is in the file: this memo
    // has no background caller at all, so there is nothing to protect from a
    // reader's ladder — and its fan-out is one fetch per distinct username
    // anybody can type, which under the background ladder is a permit held for
    // two minutes rather than twelve seconds per name.
    const source = read("src", "shared", "user", "resolve-manager-user.ts");
    assert.match(source, /awaitShared\(/);
    assert.doesNotMatch(source, /withBackgroundSleeper\(/);
    assert.match(source, /producer half is\n \* deliberately not taken here/);
  });
});
