import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Every read that prices a roster, pinned against its source: does it hand the
 * solve a season-to-date board at all?
 *
 * **This is `crawl-writes.test.ts`' bargain, for its reason.** Each file named
 * here imports `@/shared/…`, which Node's own runner cannot resolve, so the
 * arithmetic tests one folder over can prove that a board handed in is summed
 * and ranked correctly and cannot prove that any real caller hands one in. And
 * a caller that stopped is exactly the kind of fact nothing fails over: the
 * board defaults to empty, every `season_points` comes back null, and the
 * all-zero rule turns the three `season_*` metrics into em dashes — on a
 * perfectly healthy 200, beside three ROS columns that still answer. A reader
 * would see a column they had chosen quietly stop having numbers in it.
 *
 * The span is pinned beside the board for the same reason one grain up: a route
 * that read the span and never fetched, or fetched and never carried
 * `season_through`, degrades identically and says nothing.
 */

const read = (...segments: string[]) =>
  readFileSync(join(process.cwd(), ...segments), "utf8");

/** One caller: where it lives, what it is, and what losing the board costs. */
const CALLERS: [file: string[], what: string, solve: RegExp][] = [
  [
    ["src", "app", "api", "user", "[username]", "lineups", "route.ts"],
    "the manager page's batched ranks",
    /played\.board,/,
  ],
  [
    ["src", "app", "api", "league", "[leagueId]", "lineup", "route.ts"],
    "an expanded card's own league",
    /played\.board,/,
  ],
  [
    ["src", "shared", "timeline", "pricing.ts"],
    "a past stop on the history rail",
    /season_stats: trimProjections\(\s*played\.board,/,
  ],
];

describe("the season-to-date board reaches every solve", () => {
  for (const [file, what, solve] of CALLERS) {
    const source = read(...file);
    const where = file.join("/");

    test(`${where} reads the span (${what})`, () => {
      assert.match(source, /seasonToDateThrough\(season, getNflState\)/, where);
      assert.match(source, /getSeasonStats\(season, through\)/, where);
    });

    test(`${where} hands it to the solve`, () => {
      assert.match(source, solve, where);
    });

    test(`${where} says how far the span reached`, () => {
      // The reader's own provenance, on `from_week`'s terms: a card printing a
      // season total should be able to say which weeks it covers, and a span
      // nobody could read must say so rather than passing for a complete one.
      // **The span it read and not a literal**: the two routes each carry a
      // `season_through: null` of their own on the arm that answers an empty
      // payload, so a pin that accepted either would pass a file that had
      // stopped reporting the span it actually fetched.
      assert.match(source, /season_through: played\.through/, where);
    });
  }

  test("the two spans meet rather than overlapping the whole season", () => {
    // `restOfSeasonStart` answers where the projections span starts and
    // `seasonToDateThrough` answers where the stat span ends, so a page in week
    // 10 costs ten stat requests and nine projection ones. Two calls to the
    // same resolver would be eighteen of each.
    const source = read(
      "src",
      "app",
      "api",
      "user",
      "[username]",
      "lineups",
      "route.ts",
    );
    assert.match(source, /restOfSeasonStart\(season, getNflState\)/);
    assert.match(source, /seasonToDateThrough\(season, getNflState\)/);
  });
});
