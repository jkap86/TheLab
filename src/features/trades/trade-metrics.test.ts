import assert from "node:assert/strict";
import { test } from "node:test";

import { ktcPickKey } from "../../shared/ktc/picks.ts";
import { pickSlotKey } from "../../shared/trades/pick-slots.ts";
import { metricPreview } from "../shared/metric-cell.ts";
import type { TradeAsset, TradeSideContext } from "./trade-metrics.ts";
import { TRADE_METRICS, bundleAssets } from "./trade-metrics.ts";

const ktc = {
  // A quarterback, priced far apart on the two boards — which is the whole
  // reason the board travels with the number.
  qb: { sf: 8000, oneqb: 5200 },
  wr: { sf: 4000, oneqb: 4600 },
  // On KTC's board on neither: an IDP, a kicker, a deep rookie.
  unpriced: { sf: null, oneqb: null },
};

const LEAGUE = "league1";

// KTC prices a pick by third of the round for the drafts it has an opinion
// about, and carries a single untiered row for the ones it doesn't.
const pickKtc = {
  [ktcPickKey("2027", 1, "early")]: { sf: 6000, oneqb: 5400 },
  [ktcPickKey("2027", 1, "mid")]: { sf: 5000, oneqb: 4500 },
  [ktcPickKey("2027", 1, "late")]: { sf: 4000, oneqb: 3600 },
  [ktcPickKey("2028", 3, null)]: { sf: 900, oneqb: 800 },
};

/** A pick of roster 4's, which is what names it — see `TradePickAsset`. */
const pick = (season: string, round: number) => ({
  season,
  round,
  roster_id: 4,
  user_id: "user4",
});

const ctx = (
  received: Partial<TradeSideContext["received"]>,
  superflex = true,
  // Where roster 4 picks in a 12-team league, when the league has set an order.
  slot: number | null = null,
): TradeSideContext => ({
  received: { players: [], picks: [], faab: 0, ...received },
  ktc,
  pickKtc,
  superflex,
  leagueId: LEAGUE,
  pickSlots:
    slot === null ? {} : { [pickSlotKey(LEAGUE, "2027", 4)]: slot },
  teams: 12,
});

const cell = (key: string, context: TradeSideContext) =>
  TRADE_METRICS.find((m) => m.key === key)!.cell(context);

test("TRADE_METRICS", async (t) => {
  await t.test("KTC sums the haul on the league's own board", () => {
    assert.equal(
      metricPreview(cell("ktc", ctx({ players: ["qb", "wr"] }))),
      "12,000",
    );
    assert.equal(
      metricPreview(cell("ktc", ctx({ players: ["qb", "wr"] }, false))),
      "9,800",
    );
  });

  // The board is ~500 dynasty skill players deep, so a haul it can't price is a
  // haul it has nothing to say about — never a value of zero.
  await t.test("an unpriced haul is an em dash, not zero", () => {
    const unpriced = cell("ktc", ctx({ players: ["unpriced"] }));
    assert.equal(unpriced.kind === "value" && unpriced.text, null);
    assert.equal(metricPreview(unpriced), "—");
  });

  await t.test("a partly priced haul says how much of itself it priced", () => {
    const partial = cell("ktc", ctx({ players: ["qb", "unpriced"] }));
    assert.equal(metricPreview(partial), "8,000");
    assert.match(partial.title, /1 of 2 assets priced/);
  });

  // The change this catalogue was rewritten for: a pick is an asset KTC prices,
  // and on this board it is routinely the whole trade.
  await t.test("KTC prices the picks in a haul, not just the players", () => {
    const picks = cell("ktc", ctx({ picks: [pick("2027", 1)] }));
    // No draft order, so the mid row stands in for the round.
    assert.equal(metricPreview(picks), "5,000");

    const placed = cell("ktc", ctx({ picks: [pick("2027", 1)] }, true, 11));
    assert.equal(metricPreview(placed), "4,000");

    const both = cell("ktc", ctx({ players: ["qb"], picks: [pick("2027", 1)] }));
    assert.equal(metricPreview(both), "13,000");
    assert.match(both.title, /2 of 2 assets priced/);
  });

  // The number is real and it isn't KTC's answer for *this* pick, which is a
  // difference worth stating rather than smoothing over.
  await t.test("a stand-in row is counted and said out loud", () => {
    const assumed = cell("ktc", ctx({ picks: [pick("2027", 1)] }));
    assert.match(assumed.title, /1 pick priced off a stand-in row/);

    const exact = cell("ktc", ctx({ picks: [pick("2027", 1)] }, true, 2));
    assert.doesNotMatch(exact.title, /stand-in/);
  });

  // A draft that has since happened, or one further out than KTC prices.
  await t.test("a pick the board doesn't carry is an em dash", () => {
    const gone = cell("ktc", ctx({ picks: [pick("2024", 1)] }));
    assert.equal(gone.kind === "value" && gone.text, null);
    assert.match(gone.title, /Nothing in this haul is priced/);
  });

  // A count is a fact about the trade either way: this side took only picks.
  await t.test("the haul counts print zero rather than an em dash", () => {
    assert.equal(metricPreview(cell("players", ctx({}))), "0");
    assert.equal(metricPreview(cell("picks", ctx({}))), "0");
  });

  await t.test("FAAB is absent below a dollar, since most trades move none", () => {
    assert.equal(metricPreview(cell("faab", ctx({ faab: 0 }))), "—");
    assert.equal(metricPreview(cell("faab", ctx({ faab: 25 }))), "$25");
  });
});

test("bundleAssets", async (t) => {
  await t.test("lists players, then picks, then FAAB", () => {
    const moved = pick("2029", 3);
    assert.deepEqual(
      bundleAssets({ players: ["qb", "wr"], picks: [moved], faab: 25 }),
      [
        { kind: "player", id: "qb" },
        { kind: "player", id: "wr" },
        { kind: "pick", pick: moved },
        { kind: "faab", amount: 25 },
      ],
    );
  });

  // The same rule the FAAB column follows: none moved is not a line.
  await t.test("no FAAB is no line", () => {
    assert.deepEqual(bundleAssets({ players: [], picks: [], faab: 0 }), []);
  });
});

test("per-asset values", async (t) => {
  const read = (key: string, context: TradeSideContext, asset: TradeAsset) =>
    TRADE_METRICS.find((m) => m.key === key)!.asset?.(context, asset) ?? null;

  await t.test("KTC prices a player on the league's own board", () => {
    const context = ctx({ players: ["qb"] });
    assert.equal(read("ktc", context, { kind: "player", id: "qb" })?.text, "8,000");
    assert.equal(
      read("ktc", ctx({ players: ["qb"] }, false), { kind: "player", id: "qb" })
        ?.text,
      "5,200",
    );
  });

  // Covered by the board and not on it — a genuine gap, so a dash.
  await t.test("an unpriced player is a cell with no number", () => {
    const cell = read("ktc", ctx({ players: ["unpriced"] }), {
      kind: "player",
      id: "unpriced",
    });
    assert.equal(cell?.text, null);
    assert.match(cell!.title, /Not priced/);
  });

  await t.test("KTC prices a pick off the row it lands on", () => {
    const placed = ctx({ picks: [pick("2027", 1)] }, true, 2);
    const cell = read("ktc", placed, { kind: "pick", pick: pick("2027", 1) });
    assert.equal(cell?.text, "6,000");
    // The row, not the pick: what was priced is the early third of the round.
    assert.match(cell!.title, /2027 Early 1st/);
    assert.doesNotMatch(cell!.title, /draft order not set/);
  });

  await t.test("an unplaced pick names the row standing in for it", () => {
    const cell = read("ktc", ctx({ picks: [pick("2027", 1)] }), {
      kind: "pick",
      pick: pick("2027", 1),
    });
    assert.equal(cell?.text, "5,000");
    assert.match(cell!.title, /2027 Mid 1st \(draft order not set\)/);
  });

  // Covered by the board and off it — the same genuine gap an unpriced player is.
  await t.test("a pick the board doesn't carry is a cell with no number", () => {
    const cell = read("ktc", ctx({ picks: [pick("2024", 1)] }), {
      kind: "pick",
      pick: pick("2024", 1),
    });
    assert.equal(cell?.text, null);
    assert.match(cell!.title, /Not priced/);
  });

  // Never covered by the board at all — a dash here would report a hole in a
  // board FAAB was never on.
  await t.test("FAAB has no cell rather than an empty one", () => {
    assert.equal(read("ktc", ctx({ faab: 25 }), { kind: "faab", amount: 25 }), null);
  });

  // A count of players is 1 on every line, which is a column of ones.
  await t.test("the haul counts have no per-asset form", () => {
    for (const key of ["players", "picks", "faab"]) {
      assert.equal(TRADE_METRICS.find((m) => m.key === key)!.asset, undefined);
    }
  });
});
