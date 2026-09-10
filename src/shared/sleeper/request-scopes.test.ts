import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    [["src", "shared", "gametime", "live.ts"], "the gametime week room"],
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

describe("every route that reaches Sleeper declares the interactive budget", () => {
  /**
   * The names that reach `sleeperGet`, directly or a few modules down.
   *
   * Deliberately a list of *readers* rather than a transitive import walk: what
   * matters is whether a handler can end up queueing on the Sleeper limiter,
   * and these are the seven doors to it. `refreshLeague` and
   * `extendLeagueHistory` are absent on purpose — they open their own
   * background scope, so a route whose only Sleeper reach is one of those has
   * nothing to declare.
   */
  const REACHES_SLEEPER =
    /getActiveSeason|resolveManagerUser|getNflState|currentWeek|restOfSeasonStart|getRosProjections|getWeekProjections|getWeekStats|getNflWeekScores|trackPlaceholderDraft|readWeekFeeds|syncManagerLeagues/;

  const ROUTES: string[][] = [
    ["src", "app", "api", "trades", "route.ts"],
    ["src", "app", "api", "trades", "leagues", "route.ts"],
    ["src", "app", "api", "trades", "facets", "route.ts"],
    ["src", "app", "api", "user", "[username]", "route.ts"],
    ["src", "app", "api", "user", "[username]", "players", "route.ts"],
    ["src", "app", "api", "user", "[username]", "leaguemates", "route.ts"],
    ["src", "app", "api", "user", "[username]", "leaguemate-rosters", "route.ts"],
    ["src", "app", "api", "user", "[username]", "leagues", "route.ts"],
    ["src", "app", "api", "user", "[username]", "lineups", "route.ts"],
    ["src", "app", "api", "user", "[username]", "lineup-check", "route.ts"],
    ["src", "app", "api", "user", "[username]", "gametime", "route.ts"],
    ["src", "app", "api", "user", "[username]", "gametime", "stream", "route.ts"],
    ["src", "app", "api", "league", "[leagueId]", "lineup", "route.ts"],
    ["src", "app", "api", "league", "[leagueId]", "timeline", "route.ts"],
    ["src", "app", "api", "picktracker", "[leagueId]", "route.ts"],
    ["src", "app", "trades", "page.tsx"],
  ];

  for (const route of ROUTES) {
    const path = route.join("/");
    test(path, () => {
      const source = read(...route);
      assert.match(
        source,
        REACHES_SLEEPER,
        `${path} is listed here because it reaches Sleeper; if it no longer does, remove it`,
      );
      assert.match(
        source,
        /withInteractiveSleeper\(/,
        `${path} answers a reader and must say so`,
      );
    });
  }
});
