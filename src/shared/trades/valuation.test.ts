import assert from "node:assert/strict";
import { test } from "node:test";

import { ktcPickKey } from "../ktc/picks.ts";
import { assetKey } from "./asset-keys.ts";
import { draftOrderKey } from "./pick-slots.ts";
import { readTradeValues } from "./valuation.ts";
import type {
  TradeKtcMarket,
  TradeValuationInput,
  TradeValuationLeague,
} from "./valuation.ts";

const L = "L1";

const league = (
  over: Partial<TradeValuationLeague> = {},
): TradeValuationLeague => ({
  superflex: false,
  total_rosters: 12,
  league_type: 2,
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
  scoring_settings: { rec: 1, rush_yd: 0.1 },
  draft_rounds: 4,
  ...over,
});

const pick = (season: string, round: number, roster_id: number) => ({
  season,
  round,
  roster_id,
  user_id: null,
});

const trade = (players: string[], picks: ReturnType<typeof pick>[] = []) => ({
  transaction_id: "t1",
  league_id: L,
  week: null,
  completed_at: 1,
  sides: [{ roster_id: 1, user_id: null, players, picks, faab: 0 }],
});

/** One market with a flat 1QB/SF price per id, and no picks unless named. */
const market = (
  values: Record<string, number>,
  picks: Record<string, number> = {},
): TradeKtcMarket => ({
  values: Object.fromEntries(
    Object.entries(values).map(([id, v]) => [id, { sf: v, oneqb: v }]),
  ),
  picks: Object.fromEntries(
    Object.entries(picks).map(([key, v]) => [key, { sf: v, oneqb: v }]),
  ),
  updated_at: "2026-09-04T12:00:00.000Z",
});

const read = (over: Partial<TradeValuationInput> = {}) =>
  readTradeValues({
    trades: [trade([])],
    leagues: new Map([[L, league()]]),
    rosters: new Map(),
    orders: new Map(),
    adp: { superflex: new Map(), standard: new Map() },
    projections: {},
    fromWeek: 5,
    markets: {},
    ...over,
  });

const ktcOf = (
  out: ReturnType<typeof read>,
  asset: string | ReturnType<typeof pick>,
) => out.assetValues[assetKey(L, asset)]?.ktc.dynasty ?? null;

test("a rank places an asset among its league's, not among the page's", () => {
  // Four players rostered in the league; the trade names one of them. The rank
  // has to be over the four, not over the one on the card — which is the whole
  // reason this is computed here rather than in the browser.
  const out = read({
    trades: [trade(["b"])],
    rosters: new Map([[L, ["a", "b", "c", "d"]]]),
    markets: { dynasty: market({ a: 90, b: 80, c: 70, d: 60 }) },
  });
  assert.deepEqual(ktcOf(out, "b"), { value: 80, rank: { rank: 2, of: 4 } });
});

test("ties share the better rank and the next distinct one skips", () => {
  const out = read({
    trades: [trade(["b", "d"])],
    rosters: new Map([[L, ["a", "b", "c", "d"]]]),
    markets: { dynasty: market({ a: 90, b: 80, c: 80, d: 60 }) },
  });
  // Two at 80 both read 2nd, and the 60 below them is 4th rather than 3rd.
  assert.deepEqual(ktcOf(out, "b")?.rank, { rank: 2, of: 4 });
  assert.deepEqual(ktcOf(out, "d")?.rank, { rank: 4, of: 4 });
});

test("a traded player nobody rosters is still inside his own population", () => {
  // The player was dropped after the trade, so he is on no roster. Left out of
  // the population he would rank `of + 1` and the meter would run past its
  // own track.
  const out = read({
    trades: [trade(["gone"])],
    rosters: new Map([[L, ["a", "b"]]]),
    markets: { dynasty: market({ a: 90, b: 80, gone: 10 }) },
  });
  assert.deepEqual(ktcOf(out, "gone"), { value: 10, rank: { rank: 3, of: 3 } });
});

test("a population of one and an all-zero population both rank null", () => {
  const alone = read({
    trades: [trade(["a"])],
    rosters: new Map([[L, ["a"]]]),
    markets: { dynasty: market({ a: 90 }) },
  });
  assert.deepEqual(ktcOf(alone, "a"), { value: 90, rank: null });

  // "1st of 12" among all-zero figures is a claim — `MetricRank`'s own rule.
  const flat = read({
    trades: [trade(["a"])],
    rosters: new Map([[L, ["a", "b", "c"]]]),
    markets: { dynasty: market({ a: 0, b: 0, c: 0 }) },
  });
  assert.deepEqual(ktcOf(flat, "a"), { value: 0, rank: null });
});

test("the pick grid is the population picks are ranked against", () => {
  // KTC prices one round; the league's grid is that round times its twelve
  // rosters, all untiered because no draft order is set. Every one of them is
  // the same price, so the pick shares first place with all twelve — which is
  // the population being the grid rather than the one pick on the card.
  const first = pick("2027", 1, 5);
  const out = read({
    trades: [trade([], [first])],
    rosters: new Map([[L, ["a"]]]),
    markets: {
      dynasty: market({ a: 9000 }, { [ktcPickKey("2027", 1, null)]: 5000 }),
    },
  });
  assert.equal(ktcOf(out, first)?.value, 5000);
  // One player at 9000 above twelve picks at 5000, all sharing 2nd.
  assert.deepEqual(ktcOf(out, first)?.rank, { rank: 2, of: 13 });
});

test("a pick's tier comes off the league's own draft order", () => {
  const early = pick("2027", 1, 2);
  const out = read({
    trades: [trade([], [early])],
    orders: new Map([[draftOrderKey(L, "2027"), new Map([[2, 2]])]]),
    markets: {
      dynasty: market(
        {},
        {
          [ktcPickKey("2027", 1, "early")]: 6000,
          [ktcPickKey("2027", 1, "mid")]: 5000,
          [ktcPickKey("2027", 1, "late")]: 4000,
        },
      ),
    },
  });
  // Slot 2 of 12 is an early first, and that is the row it is priced off.
  assert.equal(ktcOf(out, early)?.value, 6000);
});

test("a pick prices on KeepTradeCut alone", () => {
  const first = pick("2027", 1, 5);
  const out = read({
    trades: [trade([], [first])],
    markets: { dynasty: market({}, { [ktcPickKey("2027", 1, null)]: 5000 }) },
    adp: { superflex: new Map(), standard: new Map([["x", { board: "full" as const, adp: 1 }]]) },
    projections: { x: { stats: { rec: 100 }, weeks: [5] } },
  });
  const entry = out.assetValues[assetKey(L, first)];
  // Neither an ADP ladder nor a projection exists for a pick, and both are
  // absent rather than zero — a zero would say a 2027 first is worth nothing.
  assert.equal(entry?.capital, null);
  assert.equal(entry?.ros, null);
  assert.equal(entry?.ktc.dynasty?.value, 5000);
});

test("a league with no stored size cannot anchor the capital curve", () => {
  const adp = {
    superflex: new Map(),
    standard: new Map([["a", { board: "full" as const, adp: 1 }]]),
  };
  const sized = read({ trades: [trade(["a"])], adp });
  assert.ok((sized.assetValues[assetKey(L, "a")]?.capital?.value ?? 0) > 0);

  // `leagueAdpPool` is teams × starters, and a pool of zero collapses every
  // player onto the peak — so a row stored before the league answered prices
  // nobody rather than pricing everybody the same.
  const unsized = read({
    trades: [trade(["a"])],
    leagues: new Map([[L, league({ total_rosters: 0 })]]),
    adp,
  });
  assert.equal(unsized.assetValues[assetKey(L, "a")]?.capital, null);
});

test("a league with no stored scoring cannot score a projection", () => {
  const projections = { a: { stats: { rec: 60 }, weeks: [5, 6] } };
  const scored = read({ trades: [trade(["a"])], projections });
  assert.equal(scored.assetValues[assetKey(L, "a")]?.ros?.value, 60);

  // `scoreStatLine` reads a null scoring table as nothing scored and answers a
  // flat zero, which would put every player in the league on one figure.
  const unscored = read({
    trades: [trade(["a"])],
    leagues: new Map([[L, league({ scoring_settings: null })]]),
    projections,
  });
  assert.equal(unscored.assetValues[assetKey(L, "a")]?.ros, null);
});

test("a player the feed says nothing about has no projection, not a zero", () => {
  const out = read({
    trades: [trade(["a", "b"])],
    rosters: new Map([[L, ["a", "b", "c"]]]),
    projections: {
      // A real projected zero: a week, and nothing expected of him.
      a: { stats: {}, weeks: [5] },
      // No week at all — the feed has nothing to say about him.
      b: { stats: { rec: 40 }, weeks: [] },
      c: { stats: { rec: 100 }, weeks: [5] },
    },
  });
  assert.equal(out.assetValues[assetKey(L, "a")]?.ros?.value, 0);
  assert.equal(out.assetValues[assetKey(L, "b")]?.ros, null);
});

test("an unreadable market costs its own column and nothing else", () => {
  const out = read({
    trades: [trade(["a"])],
    rosters: new Map([[L, ["a", "b"]]]),
    markets: { redraft: market({ a: 90, b: 10 }) },
  });
  const entry = out.assetValues[assetKey(L, "a")];
  assert.equal(entry?.ktc.dynasty, null);
  assert.deepEqual(entry?.ktc.redraft, { value: 90, rank: { rank: 1, of: 2 } });
  assert.equal(out.values.ktc?.scraped_at.dynasty, null);
});

test("a league with no stored row prices nothing at all", () => {
  const out = read({ trades: [trade(["a"])], leagues: new Map() });
  assert.deepEqual(out.assetValues, {});
});

test("auto reads mixed only where the page holds both kinds of league", () => {
  const markets = { dynasty: market({ a: 1 }), redraft: market({ a: 1 }) };
  const dynastyOnly = read({ trades: [trade(["a"])], markets });
  assert.equal(dynastyOnly.values.ktc?.auto_board, "dynasty");

  const mixed = readTradeValues({
    ...({
      trades: [trade(["a"]), { ...trade(["a"]), transaction_id: "t2", league_id: "L2" }],
      leagues: new Map([
        [L, league()],
        ["L2", league({ league_type: 0 })],
      ]),
      rosters: new Map(),
      orders: new Map(),
      adp: { superflex: new Map(), standard: new Map() },
      projections: {},
      fromWeek: 5,
      markets,
    } satisfies TradeValuationInput),
  });
  assert.equal(mixed.values.ktc?.auto_board, "mixed");
});

test("a basis with nothing behind it says so rather than shipping an empty board", () => {
  const bare = read();
  assert.equal(bare.values.ktc, null);
  assert.equal(bare.values.capital, null);
  assert.deepEqual(bare.values.ros, { from_week: 5 });

  // A past season has no rest-of-season span at all.
  assert.equal(read({ fromWeek: null }).values.ros, null);
  assert.deepEqual(
    read({
      adp: { superflex: new Map(), standard: new Map([["a", { board: "full", adp: 3 }]]) },
    }).values.capital,
    { players: 1 },
  );
});
