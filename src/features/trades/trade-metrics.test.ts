import assert from "node:assert/strict";
import { test } from "node:test";

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

const ctx = (
  received: Partial<TradeSideContext["received"]>,
  superflex = true,
): TradeSideContext => ({
  received: { players: [], picks: [], faab: 0, ...received },
  ktc,
  superflex,
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
    assert.match(partial.title, /1 of 2 players priced/);
  });

  // KTC carries no picks at all, so a pick-only haul isn't a gap in the board.
  await t.test("a pick-only haul names why it has no price", () => {
    const picks = cell(
      "ktc",
      ctx({ picks: [{ season: "2029", round: 3, roster_id: 4, user_id: "user4" }] }),
    );
    assert.equal(picks.kind === "value" && picks.text, null);
    assert.match(picks.title, /aren't on KTC's board/);
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
    const pick = { season: "2029", round: 3, roster_id: 4, user_id: "user4" };
    assert.deepEqual(
      bundleAssets({ players: ["qb", "wr"], picks: [pick], faab: 25 }),
      [
        { kind: "player", id: "qb" },
        { kind: "player", id: "wr" },
        { kind: "pick", pick },
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

  // Never covered by the board at all — a dash here would report a hole in a
  // board these assets were never on.
  await t.test("picks and FAAB have no cell rather than an empty one", () => {
    const context = ctx({
      picks: [{ season: "2029", round: 3, roster_id: 4, user_id: "user4" }],
      faab: 25,
    });
    assert.equal(
      read("ktc", context, {
        kind: "pick",
        pick: { season: "2029", round: 3, roster_id: 4, user_id: "user4" },
      }),
      null,
    );
    assert.equal(read("ktc", context, { kind: "faab", amount: 25 }), null);
  });

  // A count of players is 1 on every line, which is a column of ones.
  await t.test("the haul counts have no per-asset form", () => {
    for (const key of ["players", "picks", "faab"]) {
      assert.equal(TRADE_METRICS.find((m) => m.key === key)!.asset, undefined);
    }
  });
});
