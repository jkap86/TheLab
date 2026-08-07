import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_TRADE_PAGE_SIZE,
  MAX_BODY_LEAGUE_IDS,
  MAX_TRADE_PAGE_SIZE,
  MAX_TRADE_SIDES,
  hasTradeNarrowing,
  isUnnarrowed,
  leagueScopeQuery,
  parseTradeQuery,
  parseTradeScopeBody,
} from "./params.ts";

const parse = (query: string) =>
  parseTradeQuery(new URLSearchParams(query), "2026");

/**
 * The half of `/api/trades` that decides what the SQL beside it is allowed to
 * see. Every field is a *narrowing*, so the rule under test throughout is that
 * an unreadable value falls back to not narrowing rather than failing the
 * request — a stale bookmark should show a board, not an error page.
 */
describe("parseTradeQuery", () => {
  test("an empty query narrows nothing", () => {
    const query = parse("");
    assert.equal(isUnnarrowed(query), true);
    assert.equal(query.leagues, null);
    assert.equal(query.excludeLeagues, null);
    assert.equal(query.limit, DEFAULT_TRADE_PAGE_SIZE);
    assert.equal(query.match, "all");
  });

  test("an absent league list and an empty one are different answers", () => {
    // Absent is "not narrowing"; empty is "the rules matched nothing", and the
    // honest board for that is empty. Collapsing them would show every trade to
    // a reader who asked for none.
    assert.equal(parse("").leagues, null);
    assert.deepEqual(parse("leagues=").leagues, []);
    assert.deepEqual(parse("leagues=a,b").leagues, ["a", "b"]);
    assert.deepEqual(parse("xleagues=a").excludeLeagues, ["a"]);
  });

  test("the window is epoch milliseconds, and junk is an open end", () => {
    assert.equal(parse("from=1786000000000").from, 1786000000000);
    assert.equal(parse("to=1786000000000").to, 1786000000000);
    for (const bad of ["from=abc", "from=-1", "from=1.5", "from="]) {
      assert.equal(parse(bad).from, null, bad);
    }
  });

  test("a side collects its manager and what it received", () => {
    const [side] = parse(
      "s1manager=u1&s1players=p1,p2&s1players=p1&s1picks=2026-1",
    ).sides;
    assert.equal(side.manager, "u1");
    assert.deepEqual(side.players, ["p1", "p2"]);
    assert.deepEqual(side.picks, ["2026-1"]);
  });

  test("two sides are two sides, in the order they were indexed", () => {
    const sides = parse("s1manager=u1&s2players=p1").sides;
    assert.equal(sides.length, 2);
    assert.equal(sides[0].manager, "u1");
    assert.deepEqual(sides[1].players, ["p1"]);
  });

  test("an empty bay is dropped, so the index is an ordering and not identity", () => {
    // A bay the reader emptied is "don't care", never a claim that some side
    // received nothing — so it must not reach the SQL as a constraint at all.
    assert.deepEqual(parse("s1players=&s1manager=").sides, []);
    // Which means a lone `s2` is one side, the same query as a lone `s1`.
    assert.deepEqual(parse("s2players=p1").sides, parse("s1players=p1").sides);
  });

  test("sides past the cap are ignored rather than growing the SQL", () => {
    const query = new URLSearchParams();
    for (let index = 1; index <= MAX_TRADE_SIDES + 3; index++) {
      query.set(`s${index}players`, `p${index}`);
    }
    assert.equal(parse(query.toString()).sides.length, MAX_TRADE_SIDES);
  });

  test("match is `all` unless `any` is asked for by name", () => {
    assert.equal(parse("match=any").match, "any");
    assert.equal(parse("match=ALL").match, "all");
    assert.equal(parse("match=nonsense").match, "all");
  });

  test("a circle needs an account, and an unknown one is not a circle", () => {
    assert.equal(parse("circle=mine&user=u1").circle, "mine");
    assert.equal(parse("circle=mine&user=u1").user, "u1");
    assert.equal(parse("circle=leaguemate-leagues&user=u1").circle, "leaguemate-leagues");

    // Nobody at the centre of it, so there is no circle to draw — and forcing it
    // open rather than 400ing follows the rule the rest of this parser does: the
    // neutral form of a narrowing is not narrowing.
    for (const bad of ["circle=mine", "circle=mine&user=", "circle=mine&user=%20"]) {
      assert.equal(parse(bad).circle, "all", bad);
      assert.equal(parse(bad).user, null, bad);
    }
    // A spelling this build doesn't know is the whole market, never an empty
    // board: a bookmark from a later build should widen, not break.
    assert.equal(parse("circle=friends&user=u1").circle, "all");
    assert.equal(parse("user=u1").circle, "all");
  });

  test("the limit is clamped rather than rejected", () => {
    assert.equal(parse("limit=50").limit, 50);
    assert.equal(parse(`limit=${MAX_TRADE_PAGE_SIZE + 1}`).limit, DEFAULT_TRADE_PAGE_SIZE);
    assert.equal(parse("limit=0").limit, DEFAULT_TRADE_PAGE_SIZE);
    assert.equal(parse("limit=abc").limit, DEFAULT_TRADE_PAGE_SIZE);
  });

  test("the cursor is carried through opaque, and absent is a first page", () => {
    // It is the keyset resume token, decoded a layer further in — so nothing
    // here may normalise or validate it. A cursor silently dropped restarts
    // every page at the top of the board, which as an infinite scroll is the
    // same twenty trades appended forever rather than an error.
    assert.equal(parse("cursor=eyJhdCI6MSwiaWQiOiJ0OSJ9").cursor, "eyJhdCI6MSwiaWQiOiJ0OSJ9");
    assert.equal(parse("").cursor, null);
  });

  test("a cursor is not a narrowing, so it doesn't move the total off the stored row", () => {
    // Paging deeper into the board asks the same question — counting the
    // population again per page is exactly what precomputing it avoided.
    assert.equal(isUnnarrowed(parse("cursor=abc")), true);
    assert.equal(isUnnarrowed(parse("limit=50")), true);
  });
});

describe("what counts as narrowed", () => {
  test("any filter at all takes the query off the stored count", () => {
    // `isUnnarrowed` is what decides whether the total is read out of
    // `trade_market_stats` or counted live, so a false positive here would
    // quote a whole season's size on a narrowed board.
    for (const query of [
      "leagues=a",
      "xleagues=a",
      "from=1",
      "to=1",
      "s1players=p1",
      "s1picks=2026-1",
      "s1manager=u1",
      "s2players=p1",
      "circle=mine&user=u1",
    ]) {
      assert.equal(isUnnarrowed(parse(query)), false, query);
    }
    // A user with no circle narrows nothing, so the stored count still stands.
    assert.equal(isUnnarrowed(parse("user=u1")), true);
    // Pagination and the match mode are not narrowings.
    assert.equal(isUnnarrowed(parse("limit=10&cursor=x&match=any")), true);
  });

  test("the league scope is what the headline's `of M` is counted over", () => {
    const query = parse(
      "leagues=a,b&from=1&s1manager=u1&s1players=p1&s2picks=2026-1&circle=mine&user=u1",
    );
    const scope = leagueScopeQuery(query);
    assert.deepEqual(scope.leagues, ["a", "b"]);
    // The circle stays: it is where the reader is standing, so it belongs in
    // the denominator rather than in what the denominator is being cut down to.
    assert.equal(scope.circle, "mine");
    assert.equal(scope.user, "u1");
    assert.equal(scope.from, null);
    assert.deepEqual(scope.sides, []);
  });

  test("with only league filters the two counts are the same query", () => {
    // Which is what lets the route skip the second count entirely.
    assert.equal(hasTradeNarrowing(parse("leagues=a")), false);
    assert.equal(hasTradeNarrowing(parse("circle=mine&user=u1")), false);
    assert.equal(hasTradeNarrowing(parse("leagues=a&from=1")), true);
    assert.equal(hasTradeNarrowing(parse("s1players=p1")), true);
  });
});

/**
 * The league scope as a POST body carries it — the path a filter set too long
 * for a request line takes.
 *
 * What is pinned here is that a body and a query string produce the *same*
 * {@link TradeQuery}: the SQL, the cursor and the counts below it cannot tell
 * which arrived, which is what stops a large scope from being a second code path
 * that narrows differently from the small one.
 */
describe("parseTradeScopeBody", () => {
  test("an unreadable body narrows nothing", () => {
    for (const body of [null, undefined, "", 7, [], "not json"]) {
      assert.deepEqual(parseTradeScopeBody(body), {
        leagues: null,
        excludeLeagues: null,
      });
    }
  });

  test("absent and empty stay different answers", () => {
    assert.equal(parseTradeScopeBody({ xleagues: ["a"] }).leagues, null);
    assert.deepEqual(parseTradeScopeBody({ leagues: [] }).leagues, []);
  });

  test("carries 500 included ids", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `L${i}`);
    assert.deepEqual(parseTradeScopeBody({ leagues: ids }).leagues, ids);
  });

  test("carries 500 excluded ids", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `L${i}`);
    const scope = parseTradeScopeBody({ xleagues: ids });
    assert.deepEqual(scope.excludeLeagues, ids);
    assert.equal(scope.leagues, null);
  });

  test("carries both lists at once", () => {
    const scope = parseTradeScopeBody({
      leagues: Array.from({ length: 600 }, (_, i) => `I${i}`),
      xleagues: Array.from({ length: 600 }, (_, i) => `X${i}`),
    });
    assert.equal(scope.leagues?.length, 600);
    assert.equal(scope.excludeLeagues?.length, 600);
  });

  test("drops entries that are not id-shaped, and deduplicates", () => {
    const scope = parseTradeScopeBody({
      leagues: ["a", "a", 7, null, "b c", "x".repeat(200), "b"],
    });
    assert.deepEqual(scope.leagues, ["a", "b"]);
  });

  test("is capped, so a body cannot ask for an unbounded ANY()", () => {
    const ids = Array.from({ length: MAX_BODY_LEAGUE_IDS + 10 }, (_, i) => `L${i}`);
    assert.equal(parseTradeScopeBody({ leagues: ids }).leagues?.length, MAX_BODY_LEAGUE_IDS);
  });
});

describe("parseTradeQuery with a scope body", () => {
  const body = (b: unknown, query = "") =>
    parseTradeQuery(new URLSearchParams(query), "2026", parseTradeScopeBody(b));

  test("a body scope reads exactly as the query-string one would", () => {
    const ids = Array.from({ length: 600 }, (_, i) => `L${i}`);
    const fromBody = body({ leagues: ids });
    const fromQuery = parse(`leagues=${ids.join(",")}`);
    assert.deepEqual(fromBody.leagues, fromQuery.leagues);
    assert.equal(isUnnarrowed(fromBody), false);
  });

  test("the rest of the query string is still read", () => {
    // Pagination and the selection never move to the body, so the keyset walk
    // is identical under both methods.
    const query = body({ leagues: ["a"] }, "cursor=abc&limit=25&from=100&s1players=p1");
    assert.equal(query.cursor, "abc");
    assert.equal(query.limit, 25);
    assert.equal(query.from, 100);
    assert.deepEqual(query.sides[0].players, ["p1"]);
  });

  test("a body list overrides the query string rather than merging", () => {
    const query = body({ leagues: ["b"] }, "leagues=a");
    assert.deepEqual(query.leagues, ["b"]);
  });

  test("an absent body list leaves the query string's alone", () => {
    assert.deepEqual(body({ xleagues: ["z"] }, "leagues=a").leagues, ["a"]);
  });
});
