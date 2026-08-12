import assert from "node:assert/strict";
import { test } from "node:test";

import { ktcPickKey } from "../../shared/ktc/picks.ts";
import { pickSlotKey } from "../../shared/trades/pick-slots.ts";
import { metricPreview } from "../shared/metric-cell.ts";
import type { RookieLadderRung } from "./pick-value.ts";
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
  // A season further out, at half the matching row above it — which is the whole
  // of what KTC is asked for by the ADP column: the ratio, not the price. It
  // carries an early row *and* an untiered one because the discount reads both
  // ends on the same row, so a fixture with only one of them would test the
  // refusal rather than the ratio.
  [ktcPickKey("2028", 1, "early")]: { sf: 3000, oneqb: 2700 },
  [ktcPickKey("2028", 1, null)]: { sf: 3000, oneqb: 2700 },
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
    rookie: false,
    redraft: { picks: 40, adp: 82, min_pick: 60, max_pick: 108, stdev: 9.4 },
    dynasty: { picks: 30, adp: 28, min_pick: 12, max_pick: 44, stdev: 6.1 },
  },
  wr: {
    player_id: "wr",
    name: "Ja'Marr Chase",
    position: "WR",
    team: "CIN",
    rookie: false,
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
    rookie: false,
    redraft: null,
    dynasty: null,
  },
};

/**
 * Twelve rookies in the order the *rookie* drafts took them — a 12-team
 * league's whole first round, so a second-rounder runs off the end of the class
 * the board priced. Each carries what the *startup* drafts pay for him, which is
 * the number the curve reads; the first four sit on exact powers of two against
 * {@link ADP_POOL}. The two scales are deliberately unrelated — see
 * `./pick-value`, where that separation is the subject.
 */
const ladder: RookieLadderRung[] = [
  1, 28, 55, 82, 109, 136, 150, 164, 178, 192, 206, 220,
].map((startupAdp, i) => ({
  player_id: `r${i + 1}`,
  name: `Rookie ${i + 1}`,
  rookieAdp: i + 1,
  rookiePicks: 20,
  startupAdp,
  startupSource: "observed" as const,
  startupPicks: 18,
}));

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
  // Both seasons, since roster 4's place in its league's draft order is the same
  // fact whichever year's pick is being looked at, and the tests price picks in
  // each.
  pickSlots:
    slot === null
      ? {}
      : {
          [pickSlotKey(LEAGUE, "2027", 4)]: slot,
          [pickSlotKey(LEAGUE, "2028", 4)]: slot,
        },
  teams: 12,
  adp,
  // The market and the curve are overridden by spreading rather than by two more
  // positional arguments — only a couple of tests vary either, and five
  // positionals is a call nobody can read.
  adpBoard: "dynasty",
  adpPool: ADP_POOL,
  steepness: 4,
  adpLadder: ladder,
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
    assert.match(none.title, /Nothing in this haul is priced/);
  });

  await t.test("a partly priced haul counts what it priced", () => {
    const partial = cell("adp", ctx({ players: ["qb", "unpriced"] }));
    assert.equal(metricPreview(partial), "5,000");
    assert.match(partial.title, /1 of 2 assets priced/);
  });

  // The rookie ladder is what puts a pick on the same scale as a player, so a
  // haul of both is one sum rather than a player total beside a shrug.
  await t.test("ADP sums the picks in a haul alongside its players", () => {
    // Roster 4 picks 3rd, so its 2027 first is rung 3 — a quarter of the peak.
    const both = cell(
      "adp",
      ctx({ players: ["qb"], picks: [pick("2027", 1)], faab: 25 }, true, 3),
    );
    assert.equal(metricPreview(both), "7,500");
    // FAAB is on no board at all, so it is not in the denominator either.
    assert.match(both.title, /2 of 2 assets priced/);
  });

  await t.test("a haul of picks alone is priced, not shrugged at", () => {
    const picksOnly = cell("adp", ctx({ picks: [pick("2027", 1)] }, true, 3));
    assert.equal(metricPreview(picksOnly), "2,500");
  });

  // The class the board priced runs out before a 12-team league's second round.
  await t.test("a pick deeper than the board's rookie class is unpriced", () => {
    const deep = cell("adp", ctx({ picks: [pick("2027", 2)] }, true, 3));
    assert.equal(deep.kind === "value" && deep.text, null);
  });

  await t.test("a FAAB-only haul says no board covers it", () => {
    const faabOnly = cell("adp", ctx({ faab: 25 }));
    assert.equal(faabOnly.kind === "value" && faabOnly.text, null);
    assert.match(faabOnly.title, /this side received neither/);
    // The KTC cell keeps the same branch — one rule, two catalogue entries.
    const ktcFaabOnly = cell("ktc", ctx({ faab: 25 }));
    assert.equal(ktcFaabOnly.kind === "value" && ktcFaabOnly.text, null);
    assert.match(ktcFaabOnly.title, /this side received neither/);
  });

  // An unplaced pick takes the middle of its round and the untiered KTC row, so
  // the number is real and is not this pick's own — which the hover says.
  await t.test("a stand-in pick is counted and said out loud", () => {
    const assumed = cell("adp", ctx({ picks: [pick("2027", 1)] }));
    assert.match(assumed.title, /1 pick priced off a stand-in/);
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

  /**
   * The catalogue carried a `Haul` family too — a count of players, of picks and
   * of FAAB — and each said what the lines drawn underneath it already say, one
   * per row. Two things go with removing them and both are worth pinning: the
   * picker is value lenses only, and *every* column has a per-asset form, which
   * is what orders the track under it. A count-shaped metric added later ranks
   * nothing, so this is the test to read before deleting.
   */
  await t.test("every column prices the haul, and prices it per line", () => {
    assert.deepEqual(
      TRADE_METRICS.map((metric) => metric.key),
      ["adp", "ktc"],
    );
    assert.ok(TRADE_METRICS.every((metric) => metric.asset));
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

  /**
   * The track ranks its lines on this, and it has to be the number rather than
   * the string it prints: `"1,250"` sorts above `"625"` as text, which is a card
   * that looks ranked and isn't. Null exactly where the text is, so a line the
   * board has nothing to say about claims no place in the ranking.
   */
  await t.test("a cell carries the number behind its text", () => {
    const priced = read("adp", ctx({ players: ["qb"] }), {
      kind: "player",
      id: "qb",
    });
    assert.equal(priced?.text, "5,000");
    assert.equal(priced?.value, 5000);

    const off = read("adp", ctx({ players: ["unpriced"] }), {
      kind: "player",
      id: "unpriced",
    });
    assert.equal(off?.value, null);

    const moved = pick("2027", 1);
    const early = read("ktc", ctx({ picks: [moved] }, true, 3), {
      kind: "pick",
      pick: moved,
    });
    assert.equal(early?.text, "6,000");
    assert.equal(early?.value, 6000);

    const gone = pick("2024", 1);
    const unreachable = read("ktc", ctx({ picks: [gone] }), {
      kind: "pick",
      pick: gone,
    });
    assert.equal(unreachable?.value, null);
  });

  await t.test("a player off the board is a cell with no number", () => {
    const cell = read("adp", ctx({ players: ["unpriced"] }), {
      kind: "player",
      id: "unpriced",
    });
    assert.equal(cell?.text, null);
    assert.match(cell!.title, /Not on the dynasty ADP board/);
  });

  // The rung is the answer, and naming the rookie is the whole of the reasoning
  // behind the number — a reader has no other way to judge it. The ADP printed
  // beside him is the **startup** one, since that is the number the curve read:
  // his rookie-draft ADP of 3 against a value of 2,500 would invite exactly the
  // confusion the two-board ladder exists to remove.
  await t.test("a pick is priced by the rookie its rung names", () => {
    const moved = pick("2027", 1);
    const cell = read("adp", ctx({ picks: [moved] }, true, 3), {
      kind: "pick",
      pick: moved,
    });
    assert.equal(cell?.text, "2,500");
    assert.match(
      cell!.title,
      /Rookie pick 3 ≈ Rookie 3, startup ADP 55\.0 on the dynasty board/,
    );
    // Nothing was assumed, so nothing is claimed — and in particular the reader
    // is not told their own league's draft order is unset when it plainly isn't.
    assert.doesNotMatch(cell!.title, /slot|interpolated|estimated/);
  });

  // KTC's only job under this column: the ratio that says what waiting costs.
  await t.test("a future pick is the same rung discounted by KTC", () => {
    const moved = pick("2028", 1);
    // Slot 4 of 12 is an early first, and KTC prices the 2028 early row at half
    // of 2027's — so rung 4's 1,250 comes back as 625. Both ends on the early
    // row, which is what makes the ratio a statement about one kind of pick.
    const cell = read("adp", ctx({ picks: [moved] }, true, 4), {
      kind: "pick",
      pick: moved,
    });
    assert.equal(cell?.text, "625");
    assert.match(cell!.title, /×0\.50 against 2027 on KTC/);
    assert.doesNotMatch(cell!.title, /estimated/);
  });

  /**
   * The three assumptions are three sentences, and the reason they were split:
   * a pick whose slot is known and whose KTC row fell back used to be reported
   * as "(draft order not set)" — a claim about the reader's own league, and a
   * false one.
   */
  await t.test("an unplaced pick reports its slot and only its slot", () => {
    const moved = pick("2027", 1);
    const cell = read("adp", ctx({ picks: [moved] }), { kind: "pick", pick: moved });
    assert.match(cell!.title, /Rookie pick 6/);
    assert.match(cell!.title, /projected mid-round slot/);
    assert.doesNotMatch(cell!.title, /future-year|interpolated/);
  });

  await t.test("a KTC fallback is reported as one, not as an unset order", () => {
    const moved = pick("2028", 1);
    // Neither season carries an early row, so both ends fall back to the generic
    // one together — still like-for-like, and still not a fact about this
    // league's draft order.
    const generic = {
      [ktcPickKey("2027", 1, null)]: { sf: 5000, oneqb: 4500 },
      [ktcPickKey("2028", 1, null)]: { sf: 3000, oneqb: 2700 },
    };
    const cell = read(
      "adp",
      { ...ctx({ picks: [moved] }, true, 4), pickKtc: generic },
      { kind: "pick", pick: moved },
    );
    assert.match(
      cell!.title,
      /future-year adjustment estimated from the generic 1st-round market/,
    );
    assert.doesNotMatch(cell!.title, /slot/);
  });

  await t.test("an interpolated startup price says which half was guessed", () => {
    const moved = pick("2027", 1);
    const guessed = ladder.map((rung, i) =>
      i === 2
        ? { ...rung, startupSource: "interpolated" as const, startupPicks: null }
        : rung,
    );
    const cell = read(
      "adp",
      { ...ctx({ picks: [moved] }, true, 3), adpLadder: guessed },
      { kind: "pick", pick: moved },
    );
    assert.match(cell!.title, /startup value interpolated from nearby rookies/);
    assert.doesNotMatch(cell!.title, /slot|future-year/);
  });

  await t.test("the ways a pick goes unpriced read differently", () => {
    const moved = pick("2027", 2);
    const past = read("adp", ctx({ picks: [moved] }, true, 3), {
      kind: "pick",
      pick: moved,
    });
    assert.equal(past?.text, null);
    assert.match(past!.title, /Deeper than the rookie class/);

    const bare = read(
      "adp",
      { ...ctx({ picks: [moved] }), adpLadder: [] },
      { kind: "pick", pick: moved },
    );
    assert.match(bare!.title, /No rookies in the dynasty rookie drafts/);

    // A ladder with places and no prices: the startup board answered nothing,
    // which is a different gap from having no rookie order at all.
    const unpriced = ladder.map((rung) => ({
      ...rung,
      startupAdp: null,
      startupSource: "none" as const,
      startupPicks: null,
    }));
    const nothing = read(
      "adp",
      { ...ctx({ picks: [pick("2027", 1)] }, true, 3), adpLadder: unpriced },
      { kind: "pick", pick: pick("2027", 1) },
    );
    assert.equal(nothing?.text, null);
    assert.match(nothing!.title, /No dynasty startup ADP/);

    const far = pick("2032", 1);
    const unknown = read("adp", ctx({ picks: [far] }, true, 3), {
      kind: "pick",
      pick: far,
    });
    assert.equal(unknown?.text, null);
    assert.match(unknown!.title, /KTC carries no like-for-like row/);
  });

  // Never covered at all, on either value column: a dash against FAAB would
  // report a hole in a board it was never on.
  await t.test("FAAB has no ADP cell rather than an empty one", () => {
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

  /**
   * The same mislabelled-estimate bug the ADP column's flags were split to fix,
   * at this column's own grain: a *placed* pick whose third KTC doesn't publish
   * is a fact about KTC's board, not about the reader's league.
   */
  await t.test("a placed pick on a broader row doesn't blame the draft order", () => {
    // Slot 4 of 12 is an early first, and this board carries only the untiered
    // 2028 row — so the price is a stand-in and the order is set all the same.
    const cell = read("ktc", ctx({ picks: [pick("2028", 1)] }, true, 4), {
      kind: "pick",
      pick: pick("2028", 1),
    });
    assert.match(cell!.title, /2028 Early 1st/);
    assert.doesNotMatch(cell!.title, /draft order not set/);

    const generic = {
      [ktcPickKey("2028", 1, null)]: { sf: 3000, oneqb: 2700 },
    };
    const stood = read(
      "ktc",
      { ...ctx({ picks: [pick("2028", 1)] }, true, 4), pickKtc: generic },
      { kind: "pick", pick: pick("2028", 1) },
    );
    assert.match(stood!.title, /2028 1st \(KTC publishes no row for that third\)/);
    assert.doesNotMatch(stood!.title, /draft order not set/);
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

});
