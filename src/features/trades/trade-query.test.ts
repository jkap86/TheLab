import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/manager";

import { DEFAULT_LEAGUE_FILTERS } from "../shared/league-filters/defaults.ts";
import { DEFAULT_TRADE_FILTERS } from "./filters.ts";
import type { TradeFilters } from "./filters.ts";
import {
  MAX_LEAGUE_IDS,
  resolveLeagueScope,
  tradeQueryKey,
  tradeQueryParams,
} from "./trade-query.ts";
import type { LeagueScope } from "./trade-query.ts";

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
} = {}) => ({
  season: "2026",
  scope: over.scope ?? ({ kind: "all" } as LeagueScope),
  filters: { ...DEFAULT_TRADE_FILTERS, ...over.filters },
  bounds: over.bounds ?? { from: null, to: null },
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
          players: ["p2", "p1"],
          picks: ["2027-1"],
          managers: ["u1"],
          match: "any",
        },
        bounds: { from: 100, to: 200 },
      }),
    );
    assert.equal(params.get("leagues"), "a,b");
    assert.equal(params.get("from"), "100");
    assert.equal(params.get("to"), "200");
    assert.equal(params.get("players"), "p1,p2");
    assert.equal(params.get("picks"), "2027-1");
    assert.equal(params.get("managers"), "u1");
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

  test("the match mode is only sent when it can change an answer", () => {
    const one = tradeQueryParams(
      request({ filters: { players: ["p1"], match: "any" } }),
    );
    assert.equal(one.get("match"), null, "one selection reads the same either way");
    const two = tradeQueryParams(
      request({ filters: { players: ["p1"], managers: ["u1"], match: "any" } }),
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
        filters: { players: ["p2", "p1"] },
      }),
    );
    const b = tradeQueryKey(
      request({
        scope: { kind: "include", ids: ["a", "b"] },
        filters: { players: ["p1", "p2"] },
      }),
    );
    assert.equal(a, b);
  });

  test("a different narrowing is a different key", () => {
    assert.notEqual(
      tradeQueryKey(request()),
      tradeQueryKey(request({ filters: { players: ["p1"] } })),
    );
    assert.notEqual(
      tradeQueryKey(request()),
      tradeQueryKey(request({ bounds: { from: 1, to: null } })),
    );
  });
});
