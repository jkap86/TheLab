import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/contract";

import { DEFAULT_LEAGUE_FILTERS } from "../shared/league-filters/defaults.ts";
import { DEFAULT_TRADE_FILTERS, EMPTY_SIDE } from "./filters.ts";
import type { TradeFilters, TradeSideFilter } from "./filters.ts";
import {
  MAX_TRADE_QUERY_CHARS,
  resolveLeagueScope,
  tradeHttpRequest,
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
  avatar_url: null,
  team_name: null,
  record: null,
  standings_rank: null,
  points_rank: null,
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
    // Sending three of three ids would be a query string, a subject key and a
    // SQL predicate for a narrowing that isn't one.
    assert.deepEqual(
      resolveLeagueScope(leagues, { ...DEFAULT_LEAGUE_FILTERS, bestBall: "no" }, true),
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

  test("a bay's `only` is spelled per bay and only where it bites", () => {
    const both = tradeQueryParams(
      request({
        filters: {
          sides: [
            side({ players: ["p1"], only: true }),
            side({ picks: ["2027-1"] }),
          ],
        },
      }),
    );
    assert.equal(both.get("s1only"), "1");
    assert.equal(both.get("s2only"), null);

    // Guarded on the bay holding an asset for the same reason `match` is: with
    // nothing named the flag cannot change an answer, the server drops it, and
    // sending it would split the cache between two identical boards.
    const bare = tradeQueryParams(
      request({ filters: { sides: [side({ manager: "u1", only: true }), EMPTY_SIDE] } }),
    );
    assert.equal(bare.get("s1only"), null);
  });

  test("an exclude scope goes on its own parameter", () => {
    const params = tradeQueryParams(
      request({ scope: { kind: "exclude", ids: ["a"] } }),
    );
    assert.equal(params.get("xleagues"), "a");
    assert.equal(params.get("leagues"), null);
  });

  test("two league sets that differ are two keys", () => {
    // The key is the paging hook's subject, so a scope that changed by one
    // league has to restart the board rather than append to the old one.
    const ids = Array.from({ length: 600 }, (_, i) => `L${i}`);
    const scope = { kind: "include" as const, ids };
    const other = { kind: "include" as const, ids: ids.slice(1) };
    assert.notEqual(
      tradeQueryKey(request({ scope })),
      tradeQueryKey(request({ scope: other })),
    );
    assert.ok(tradeQueryKey(request({ scope })).includes("leagues="));
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
    // A bay that took nothing else is a different board from the same bay
    // unconstrained — it is the whole of what the press does.
    assert.notEqual(
      tradeQueryKey(
        request({ filters: { sides: [side({ players: ["p1"] }), EMPTY_SIDE] } }),
      ),
      tradeQueryKey(
        request({
          filters: { sides: [side({ players: ["p1"], only: true }), EMPTY_SIDE] },
        }),
      ),
    );
    // And which bay makes the claim is part of it.
    assert.notEqual(
      tradeQueryKey(
        request({
          filters: {
            sides: [side({ players: ["p1"], only: true }), side({ players: ["p2"] })],
          },
        }),
      ),
      tradeQueryKey(
        request({
          filters: {
            sides: [side({ players: ["p1"] }), side({ players: ["p2"], only: true })],
          },
        }),
      ),
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

/**
 * How a request travels, which is the half that has to survive a corpus the
 * crawler keeps growing. Every case here is about the same rule: the parameters
 * are the request, and moving some of them into a body may not change what is
 * being asked for.
 */
describe("tradeHttpRequest", () => {
  /** A scope long enough that its ids cannot fit on a request line. */
  const wide = (kind: "include" | "exclude") => ({
    kind,
    ids: Array.from({ length: 400 }, (_, i) => `13920404781${String(i).padStart(6, "0")}`),
  });

  test("a request that fits stays a GET, whole", () => {
    const params = tradeQueryParams(
      request({ scope: { kind: "include", ids: ["a", "b"] } }),
    );
    const sent = tradeHttpRequest(params);
    assert.equal(sent.method, "GET");
    assert.equal(sent.body, null);
    assert.equal(String(sent.search), String(params));
  });

  test("a scope too long for the line moves into the body, in full", () => {
    const scope = wide("include");
    const params = tradeQueryParams(request({ scope }));
    const sent = tradeHttpRequest(params);

    assert.equal(sent.method, "POST");
    assert.ok(sent.search.toString().length <= MAX_TRADE_QUERY_CHARS);
    // The season stays on the line: what moves is the one parameter the reader
    // did not size, so a request is still legible in a log.
    assert.equal(sent.search.get("season"), "2026");
    assert.equal(sent.search.get("leagues"), null);

    // Nothing is dropped or truncated on the way — a narrowing quietly cut
    // short is a board showing trades the reader filtered out.
    const body = new URLSearchParams(sent.body ?? "");
    assert.deepEqual(body.get("leagues")?.split(","), [...scope.ids].sort());
  });

  test("the exclude form moves on the same terms", () => {
    const sent = tradeHttpRequest(tradeQueryParams(request({ scope: wide("exclude") })));
    assert.equal(sent.method, "POST");
    assert.equal(sent.search.get("xleagues"), null);
    assert.ok(new URLSearchParams(sent.body ?? "").get("xleagues"));
  });

  test("the line and the body together are the parameters they came from", () => {
    // The route folds them back into one `URLSearchParams` before anything
    // reads it, so what has to hold is that the two halves are the whole.
    const params = tradeQueryParams(
      request({
        scope: wide("exclude"),
        filters: { sides: [side({ manager: "u1", players: ["p1"] }), EMPTY_SIDE] },
        bounds: { from: 100, to: 200 },
      }),
    );
    const sent = tradeHttpRequest(params);

    const merged = new URLSearchParams(sent.search);
    for (const [key, value] of new URLSearchParams(sent.body ?? "")) {
      merged.set(key, value);
    }
    assert.deepEqual(
      [...merged.entries()].sort(),
      [...params.entries()].sort(),
    );
  });

  test("how a request travelled is not part of what it is", () => {
    // The key is the paging hook's subject. If the transport reached it, a
    // board would restart on the beat a scope crossed the threshold.
    const scope = wide("include");
    const key = tradeQueryKey(request({ scope }));
    assert.ok(key.includes("leagues="));
    assert.equal(tradeHttpRequest(tradeQueryParams(request({ scope }))).method, "POST");
    assert.equal(key, tradeQueryKey(request({ scope })));
  });

  test("a long request with nothing movable in it stays a GET", () => {
    // What is left is a reader's own selection, which a person cannot make long
    // enough to matter. Refusing it here would be this module declining to ask
    // for a board; leaving it is the router's honest failure if it ever happens.
    const players = Array.from({ length: 500 }, (_, i) => `player-${i}`);
    const params = tradeQueryParams(
      request({ filters: { sides: [side({ players }), EMPTY_SIDE] } }),
    );
    assert.ok(params.toString().length > MAX_TRADE_QUERY_CHARS);
    assert.equal(tradeHttpRequest(params).method, "GET");
  });
});
