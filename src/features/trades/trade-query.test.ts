import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/manager";

import { DEFAULT_LEAGUE_FILTERS } from "../shared/league-filters/defaults.ts";
import { DEFAULT_TRADE_FILTERS, EMPTY_SIDE } from "./filters.ts";
import type { TradeFilters, TradeSideFilter } from "./filters.ts";
import {
  MAX_LEAGUE_IDS,
  resolveLeagueScope,
  tradeQueryKey,
  tradeQueryParams,
} from "./trade-query.ts";
import type { LeagueScope } from "./trade-query.ts";

/** A bay, with only what the case under test cares about spelled out. */
const side = (over: Partial<TradeSideFilter> = {}): TradeSideFilter => ({
  ...EMPTY_SIDE,
  ...over,
});

const league = (id: string, over: Partial<ManagerLeague> = {}): ManagerLeague => ({
  league_id: id,
  name: id,
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: { type: 2 },
  roster_positions: ["QB", "RB", "WR", "BN"],
  scoring_settings: { rec: 1 },
  ...over,
});

const request = (over: {
  scope?: LeagueScope;
  filters?: Partial<TradeFilters>;
  bounds?: { from: number | null; to: number | null };
  user?: string | null;
} = {}) => ({
  season: "2026",
  scope: over.scope ?? ({ kind: "all" } as LeagueScope),
  filters: { ...DEFAULT_TRADE_FILTERS, ...over.filters },
  bounds: over.bounds ?? { from: null, to: null },
  user: over.user === undefined ? null : over.user,
});

/**
 * The client half of `/api/trades`'s vocabulary. It is a matched pair with
 * `shared/trades/params` and the compiler links neither end to the other, so
 * what is pinned here is the spelling — a parameter renamed on one side and not
 * the other fails as an *ignored filter*, which is the failure this exists to
 * make loud.
 */
describe("resolveLeagueScope", () => {
  const leagues = [
    league("a", { settings: { type: 2 } }),
    league("b", { settings: { type: 0 } }),
    league("c", { settings: { type: 0 } }),
  ];

  test("no active filter narrows nothing", () => {
    assert.deepEqual(
      resolveLeagueScope(leagues, DEFAULT_LEAGUE_FILTERS, false),
      { kind: "all" },
    );
  });

  test("a filter every league passes still narrows nothing", () => {
    // Sending three of three ids would be a query string, a cache key and a
    // SQL predicate for a narrowing that isn't one.
    assert.deepEqual(
      resolveLeagueScope(leagues, { ...DEFAULT_LEAGUE_FILTERS, status: "in_season" }, true),
      { kind: "all" },
    );
  });

  test("sends the shorter of the two lists", () => {
    // One dynasty league of three: include.
    assert.deepEqual(
      resolveLeagueScope(leagues, { ...DEFAULT_LEAGUE_FILTERS, type: "2" }, true),
      { kind: "include", ids: ["a"] },
    );
    // Two redraft leagues of three: exclude the one that fails.
    assert.deepEqual(
      resolveLeagueScope(leagues, { ...DEFAULT_LEAGUE_FILTERS, type: "0" }, true),
      { kind: "exclude", ids: ["a"] },
    );
  });

  test("matching nothing is an empty include, not `all`", () => {
    assert.deepEqual(
      resolveLeagueScope(leagues, { ...DEFAULT_LEAGUE_FILTERS, type: "1" }, true),
      { kind: "include", ids: [] },
    );
  });

  test("past the id ceiling it falls back to narrowing on the client", () => {
    // A query string is not a place for ten thousand characters, and the 414 it
    // would earn reads as the page being broken.
    const many = Array.from({ length: MAX_LEAGUE_IDS * 2 + 2 }, (_, i) =>
      league(`L${i}`, { settings: { type: i % 2 } }),
    );
    const scope = resolveLeagueScope(
      many,
      { ...DEFAULT_LEAGUE_FILTERS, type: "0" },
      true,
    );
    assert.equal(scope.kind, "client");
    assert.equal(
      scope.kind === "client" && scope.allowed.size,
      MAX_LEAGUE_IDS + 1,
    );
  });
});

describe("tradeQueryParams", () => {
  test("an unnarrowed request is the season alone", () => {
    assert.equal(String(tradeQueryParams(request())), "season=2026");
  });

  test("spells every filter the route reads", () => {
    const params = tradeQueryParams(
      request({
        scope: { kind: "include", ids: ["b", "a"] },
        filters: {
          sides: [
            side({ manager: "u1", players: ["p2", "p1"] }),
            side({ picks: ["2027-1"] }),
          ],
          match: "any",
        },
        bounds: { from: 100, to: 200 },
      }),
    );
    assert.equal(params.get("leagues"), "a,b");
    assert.equal(params.get("from"), "100");
    assert.equal(params.get("to"), "200");
    // Indexed by bay, so which side a thing is on survives the wire — the whole
    // point of the parameters being spelled this way rather than encoded.
    assert.equal(params.get("s1manager"), "u1");
    assert.equal(params.get("s1players"), "p1,p2");
    assert.equal(params.get("s2picks"), "2027-1");
    assert.equal(params.get("match"), "any");
  });

  test("an exclude scope goes on its own parameter", () => {
    const params = tradeQueryParams(
      request({ scope: { kind: "exclude", ids: ["a"] } }),
    );
    assert.equal(params.get("xleagues"), "a");
    assert.equal(params.get("leagues"), null);
  });

  test("a client-side scope sends no league narrowing", () => {
    const params = tradeQueryParams(
      request({ scope: { kind: "client", allowed: new Set(["a"]) } }),
    );
    assert.equal(params.get("leagues"), null);
    assert.equal(params.get("xleagues"), null);
  });

  test("the circle and the account travel together or not at all", () => {
    const both = tradeQueryParams(
      request({ filters: { circle: "leaguemates" }, user: "u9" }),
    );
    assert.equal(both.get("circle"), "leaguemates");
    assert.equal(both.get("user"), "u9");

    // The account store has no server snapshot, so the first render of the page
    // has no user — a circle sent alone would be a request for a board the route
    // resolves back to the unnarrowed one, under a *different* cache key.
    const noUser = tradeQueryParams(request({ filters: { circle: "mine" } }));
    assert.equal(noUser.get("circle"), null);
    assert.equal(noUser.get("user"), null);

    // And a user with no circle narrows nothing, so it is not an id to put in a
    // query string for every reader who has ever looked an account up.
    const noCircle = tradeQueryParams(request({ user: "u9" }));
    assert.equal(noCircle.get("user"), null);
  });

  test("an empty bay contributes no parameter at all", () => {
    // The server drops empty sides anyway, so a parameter saying a bay is empty
    // would split the cache between two identical boards.
    const params = tradeQueryParams(
      request({ filters: { sides: [side({ players: ["p1"] }), EMPTY_SIDE] } }),
    );
    assert.equal(params.get("s1players"), "p1");
    assert.equal(params.get("s2players"), null);
    assert.equal(params.get("s2manager"), null);
  });

  test("the match mode is only sent when it can change an answer", () => {
    // It reads *within* a bay, so what makes it matter is one bay holding two
    // assets — not two on the board, which across the bays is a relation.
    const one = tradeQueryParams(
      request({
        filters: { sides: [side({ players: ["p1"] }), EMPTY_SIDE], match: "any" },
      }),
    );
    assert.equal(one.get("match"), null, "one asset reads the same either way");
    const split = tradeQueryParams(
      request({
        filters: {
          sides: [side({ players: ["p1"] }), side({ players: ["p2"] })],
          match: "any",
        },
      }),
    );
    assert.equal(split.get("match"), null, "one asset a bay is still one asset");
    const two = tradeQueryParams(
      request({
        filters: {
          sides: [side({ players: ["p1"], picks: ["2027-1"] }), EMPTY_SIDE],
          match: "any",
        },
      }),
    );
    assert.equal(two.get("match"), "any");
  });
});

describe("tradeQueryKey", () => {
  test("two spellings of one request are one cache entry", () => {
    // A miss here is a fresh first page, a fresh count and a lost scroll
    // position, so the key is normalised rather than taken as written.
    const a = tradeQueryKey(
      request({
        scope: { kind: "include", ids: ["b", "a"] },
        filters: { sides: [side({ players: ["p2", "p1"] }), EMPTY_SIDE] },
      }),
    );
    const b = tradeQueryKey(
      request({
        scope: { kind: "include", ids: ["a", "b"] },
        filters: { sides: [side({ players: ["p1", "p2"] }), EMPTY_SIDE] },
      }),
    );
    assert.equal(a, b);
  });

  test("a different narrowing is a different key", () => {
    assert.notEqual(
      tradeQueryKey(request()),
      tradeQueryKey(
        request({ filters: { sides: [side({ players: ["p1"] }), EMPTY_SIDE] } }),
      ),
    );
    assert.notEqual(
      tradeQueryKey(request()),
      tradeQueryKey(request({ bounds: { from: 1, to: null } })),
    );
    // Two circles around one account are two boards, and two accounts under one
    // circle are as well — both have to reach the key or a reader who switches
    // sees the previous board's cards.
    assert.notEqual(
      tradeQueryKey(request({ filters: { circle: "mine" }, user: "u9" })),
      tradeQueryKey(request({ filters: { circle: "leaguemates" }, user: "u9" })),
    );
    assert.notEqual(
      tradeQueryKey(request({ filters: { circle: "mine" }, user: "u9" })),
      tradeQueryKey(request({ filters: { circle: "mine" }, user: "u8" })),
    );
  });
});
