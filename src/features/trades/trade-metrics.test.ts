import assert from "node:assert/strict";
import { test } from "node:test";

import { ktcPickKey } from "../../shared/ktc/picks.ts";
import { pickSlotKey } from "../../shared/trades/pick-slots.ts";
import { metricPreview } from "../shared/metric-cell.ts";
import type { TradeAsset, TradeSideContext } from "./trade-metrics.ts";
import { TRADE_METRICS, bundleAssets } from "./trade-metrics.ts";
import type { AdpPlayerPayload } from "./types";

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

/**
 * A 12-team league starting nine — the pool the ADP curve is anchored to. With
 * the default four halvings across it, value is `10000 · 2^(−(adp−1)/27)`, so
 * the ADPs below are the picks that land on exact powers of two: 1 is the peak,
 * 28 is half of it, 55 a quarter, 82 an eighth. Chosen so an expected value in a
 * test is a number a reader can check rather than a rounding to trust.
 */
const ADP_POOL = 108;

const adp: Record<string, AdpPlayerPayload> = {
  // Priced far apart on the two markets, which is the whole reason the board
  // travels with the number: a quarterback held for a decade is not the same
  // asset as one rented for a season.
  qb: {
    player_id: "qb",
    name: "Joe Burrow",
    position: "QB",
    team: "CIN",
    redraft: { picks: 40, adp: 82, min_pick: 60, max_pick: 108, stdev: 9.4 },
    dynasty: { picks: 30, adp: 28, min_pick: 12, max_pick: 44, stdev: 6.1 },
  },
  wr: {
    player_id: "wr",
    name: "Ja'Marr Chase",
    position: "WR",
    team: "CIN",
    redraft: { picks: 50, adp: 28, min_pick: 14, max_pick: 40, stdev: 4.2 },
    dynasty: { picks: 44, adp: 55, min_pick: 30, max_pick: 80, stdev: 7.7 },
  },
  // Taken in too few of the board's drafts to have an average on either — a
  // kicker, an IDP, a player past the tail the board is fetched to.
  unpriced: {
    player_id: "unpriced",
    name: "Justin Tucker",
    position: "K",
    team: "BAL",
    redraft: null,
    dynasty: null,
  },
};

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
  adp,
  // The market and the curve are overridden by spreading rather than by two more
  // positional arguments — only a couple of tests vary either, and five
  // positionals is a call nobody can read.
  adpBoard: "dynasty",
  adpPool: ADP_POOL,
  steepness: 4,
});

const cell = (key: string, context: TradeSideContext) =>
  TRADE_METRICS.find((m) => m.key === key)!.cell(context);

test("TRADE_METRICS", async (t) => {
  await t.test("ADP sums the haul on the market its league plays in", () => {
    // Dynasty: the quarterback at 28 is half the peak, the receiver at 55 a
    // quarter of it. Redraft inverts them, which is the point of reading the
    // league's own market rather than whichever half of the payload is first.
    assert.equal(
      metricPreview(cell("adp", ctx({ players: ["qb", "wr"] }))),
      "7,500",
    );
    assert.equal(
      metricPreview(
        cell("adp", { ...ctx({ players: ["qb", "wr"] }), adpBoard: "redraft" }),
      ),
      "6,250",
    );
  });

  // The panel's slider, reaching the cards rather than only the drawer's own
  // preview column — the whole reason the board and the board's curve travel
  // together.
  await t.test("a steeper curve reprices the same haul", () => {
    assert.equal(
      metricPreview(
        cell("adp", { ...ctx({ players: ["qb", "wr"] }), steepness: 8 }),
      ),
      "3,125",
    );
  });

  await t.test("a haul the board has no average for is an em dash", () => {
    const none = cell("adp", ctx({ players: ["unpriced"] }));
    assert.equal(none.kind === "value" && none.text, null);
    assert.match(none.title, /No player in this haul appears/);
  });

  await t.test("a partly priced haul counts the players it priced", () => {
    const partial = cell("adp", ctx({ players: ["qb", "unpriced"] }));
    assert.equal(metricPreview(partial), "5,000");
    assert.match(partial.title, /1 of 2 players priced/);
  });

  // ADP is an average of drafted *players*, so a pick is not a row on it. The
  // denominator counts players alone, or a haul of one player and two picks
  // would report itself a third priced when it is priced in full.
  await t.test("picks are not counted as players the board declined", () => {
    const withPick = cell(
      "adp",
      ctx({ players: ["qb"], picks: [pick("2027", 1)], faab: 25 }),
    );
    assert.equal(metricPreview(withPick), "5,000");
    assert.match(withPick.title, /1 of 1 player priced/);
  });

  await t.test("a haul of picks alone says the board holds no picks", () => {
    const picksOnly = cell("adp", ctx({ picks: [pick("2027", 1)] }));
    assert.equal(picksOnly.kind === "value" && picksOnly.text, null);
    assert.match(picksOnly.title, /this side received none/);
  });

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

  await t.test("ADP prices a player on his league's own market", () => {
    const context = ctx({ players: ["qb"] });
    assert.equal(read("adp", context, { kind: "player", id: "qb" })?.text, "5,000");
    assert.equal(
      read("adp", { ...context, adpBoard: "redraft" }, { kind: "player", id: "qb" })
        ?.text,
      "1,250",
    );
  });

  // The population the average rests on, which `/api/adp` has to state wherever
  // its number surfaces — there is no ADP endpoint, only the drafts crawled.
  await t.test("an ADP cell says what its average was taken over", () => {
    const cell = read("adp", ctx({ players: ["wr"] }), {
      kind: "player",
      id: "wr",
    });
    assert.match(cell!.title, /ADP 55\.0 on the dynasty board/);
    assert.match(cell!.title, /picks 30–80 over 44 drafts/);
  });

  await t.test("a player off the board is a cell with no number", () => {
    const cell = read("adp", ctx({ players: ["unpriced"] }), {
      kind: "player",
      id: "unpriced",
    });
    assert.equal(cell?.text, null);
    assert.match(cell!.title, /Not on the dynasty ADP board/);
  });

  // Never covered at all, the standing FAAB has on both value metrics: a dash
  // against a pick would report a hole in a board picks were never on.
  await t.test("a pick has no ADP cell rather than an empty one", () => {
    const moved = pick("2027", 1);
    assert.equal(read("adp", ctx({ picks: [moved] }), { kind: "pick", pick: moved }), null);
    assert.equal(read("adp", ctx({ faab: 25 }), { kind: "faab", amount: 25 }), null);
  });

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
