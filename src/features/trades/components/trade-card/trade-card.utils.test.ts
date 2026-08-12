import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TradeBundle } from "../../exchange.ts";
import type {
  TradeAsset,
  TradeMetric,
  TradeSideContext,
} from "../../trade-metrics.ts";
import type { TradeManager, TradePickAsset } from "../../types";
import type {
  TradeCardLookups,
  TradeCardPricing,
} from "./trade-card.types.ts";
import {
  SIDE_SEAM_COLUMN,
  SIDE_SEAM_ROW,
} from "./trade-card.constants.ts";
import {
  assetKey,
  formatTradeDate,
  formatTradeTime,
  pickOwnerLabel,
  sideContext,
  sideSeam,
  sideSpansRow,
  trackLines,
} from "./trade-card.utils.ts";

/**
 * The card's arithmetic, without a card.
 *
 * What is worth pinning here is the pair of rules that used to live inline in
 * the markup, where nothing could reach them: that a track prints per-line
 * values only when the breakdown says something the side total doesn't, and that
 * a give line is priced against its own bundle rather than the side's take. Both
 * are silent when wrong — the card still renders, with the wrong numbers.
 */

const pick = (over: Partial<TradePickAsset> = {}): TradePickAsset => ({
  season: "2027",
  round: 1,
  roster_id: 4,
  user_id: "u4",
  ...over,
});

const bundle = (over: Partial<TradeBundle> = {}): TradeBundle => ({
  players: [],
  picks: [],
  faab: 0,
  ...over,
});

const context = (over: Partial<TradeSideContext> = {}): TradeSideContext => ({
  received: bundle(),
  ktc: {},
  pickKtc: {},
  superflex: false,
  leagueId: "L1",
  pickSlots: {},
  teams: 12,
  adp: {},
  adpBoard: "redraft",
  adpPool: 108,
  steepness: 4,
  adpLadder: [],
  ...over,
});

/** A metric that reads every line, so the show/hide rule is what is on trial. */
const counting: TradeMetric = {
  key: "test",
  group: "Test",
  label: "Test",
  cell: () => ({ kind: "value", text: "total", title: "the total" }),
  asset: (_ctx, asset) => ({ text: asset.kind, value: null, title: asset.kind }),
};

/** One that covers players only — the "not covered" half of the two nulls. */
const playersOnly: TradeMetric = {
  ...counting,
  asset: (_ctx, asset) =>
    asset.kind === "player"
      ? { text: asset.id, value: null, title: asset.id }
      : null,
};

/** And one with no per-asset form at all, like every count in the catalogue. */
const totalOnly: TradeMetric = { ...counting, asset: undefined };

/**
 * What each player is worth to the metric below — `unpriced` being the line a
 * board has no number for, which is a different answer from a low one.
 */
const VALUES: Record<string, number | null> = {
  p1: 10,
  p2: 30,
  p3: 20,
  tie1: 15,
  tie2: 15,
  unpriced: null,
};

/**
 * A metric with a number on every line it covers, so the *ranking* is what is
 * on trial rather than the show/hide rule. A pick is worth more the earlier its
 * round — arbitrary arithmetic, but arithmetic that agrees with the way a
 * reader would read the list, so an expectation below can be checked rather
 * than traced.
 */
const valued: TradeMetric = {
  ...counting,
  asset: (_ctx, asset) => {
    if (asset.kind === "player") {
      const value = VALUES[asset.id] ?? null;
      return {
        text: value === null ? null : String(value),
        value,
        title: asset.id,
      };
    }
    if (asset.kind === "pick") {
      const value = 40 - asset.pick.round * 10;
      return { text: String(value), value, title: `round ${asset.pick.round}` };
    }
    return null;
  },
};

/** What a line is, in one word: the player, the pick's round, or the kind. */
const label = (line: { asset: TradeAsset }): string => {
  if (line.asset.kind === "player") return line.asset.id;
  if (line.asset.kind === "pick") return `round ${line.asset.pick.round}`;
  return line.asset.kind;
};

describe("formatTradeDate", () => {
  test("spells the month out rather than leaving it to a locale", () => {
    assert.equal(formatTradeDate(Date.UTC(2026, 6, 15, 12)), "Jul 15, 2026");
  });

  test("an undated trade says so rather than showing an epoch", () => {
    assert.equal(formatTradeDate(null), "date unknown");
    assert.doesNotMatch(formatTradeDate(null), /1970/);
  });
});

describe("formatTradeTime", () => {
  const at = (h: number, m = 0) => new Date(2026, 6, 15, h, m).getTime();

  test("a bare 12-hour clock, with no separator of its own", () => {
    assert.equal(formatTradeTime(at(15, 7)), "3:07 PM");
    assert.equal(formatTradeTime(at(9, 30)), "9:30 AM");
  });

  // It carried a leading " · " while the date and the time shared one readout
  // on the card's interior line. They are two elements on a plate now, parted
  // by a gap and a change of material, so punctuation between them would be a
  // third thing saying what the layout already says.
  test("no punctuation, since the plate parts the two facts itself", () => {
    assert.doesNotMatch(formatTradeTime(at(15, 7)), /·/);
    assert.doesNotMatch(formatTradeTime(at(15, 7)), /^\s/);
  });

  test("both noons read as 12, never as 0", () => {
    assert.equal(formatTradeTime(at(0, 5)), "12:05 AM");
    assert.equal(formatTradeTime(at(12, 5)), "12:05 PM");
  });

  test("minutes are zero-padded, so the column stays a column", () => {
    assert.equal(formatTradeTime(at(1, 1)), "1:01 AM");
  });

  // The empty string is what draws no element at all beside the date's words.
  test("an undated trade adds nothing, so the date's words stand alone", () => {
    assert.equal(formatTradeTime(null), "");
  });
});

describe("pickOwnerLabel", () => {
  const managers: Record<string, TradeManager> = {
    u4: { user_id: "u4", display_name: "jkap", avatar_url: null } as TradeManager,
    u5: { user_id: "u5", display_name: "", avatar_url: null } as TradeManager,
  };

  test("names the person the pick came from", () => {
    assert.equal(pickOwnerLabel(pick(), managers), "jkap");
  });

  test("falls back to the roster for an uncached owner", () => {
    assert.equal(
      pickOwnerLabel(pick({ user_id: "nobody" }), managers),
      "roster 4",
    );
    assert.equal(pickOwnerLabel(pick({ user_id: null }), managers), "roster 4");
  });

  test("an empty display name is not a name", () => {
    assert.equal(pickOwnerLabel(pick({ user_id: "u5" }), managers), "roster 4");
  });
});

describe("assetKey", () => {
  test("the same asset twice in one haul keys differently", () => {
    const a: TradeAsset = { kind: "pick", pick: pick() };
    assert.notEqual(assetKey(a, 0), assetKey(a, 1));
  });

  test("every kind keys, including the one with no identity of its own", () => {
    const keys = [
      assetKey({ kind: "player", id: "p1" }, 0),
      assetKey({ kind: "pick", pick: pick() }, 1),
      assetKey({ kind: "faab", amount: 50 }, 2),
    ];
    assert.equal(new Set(keys).size, 3);
  });
});

describe("sideContext", () => {
  test("carries every field a metric reads, from the two bundles", () => {
    const lookups: TradeCardLookups = {
      players: {},
      managers: {},
      pickSlots: { "L1|2027|4": 3 },
    };
    const pricing: TradeCardPricing = {
      metric: counting,
      ktc: { p1: { sf: 10, oneqb: 20 } },
      pickKtc: { "2027|1|mid": { sf: 30, oneqb: 40 } },
      superflex: true,
      teams: 10,
      adp: {
        p1: {
          player_id: "p1",
          name: "A Player",
          position: "RB",
          team: "SF",
          rookie: false,
          redraft: null,
          dynasty: { picks: 12, adp: 16, min_pick: 8, max_pick: 30, stdev: 4 },
        },
      },
      adpBoard: "dynasty",
      adpLadder: [
        {
          player_id: "r1",
          name: "A Rookie",
          rookieAdp: 1,
          rookiePicks: 20,
          startupAdp: 4,
          startupSource: "observed" as const,
          startupPicks: 18,
        },
      ],
      adpPool: 60,
      steepness: 4,
    };
    const received = bundle({ players: ["p1"] });

    assert.deepEqual(sideContext(pricing, lookups, "L1", received), {
      received,
      ktc: pricing.ktc,
      pickKtc: pricing.pickKtc,
      superflex: true,
      leagueId: "L1",
      pickSlots: lookups.pickSlots,
      teams: 10,
      adp: pricing.adp,
      adpBoard: "dynasty",
      adpLadder: pricing.adpLadder,
      adpPool: 60,
      steepness: 4,
    });
  });

  test("an unanswered league list reads as unplaced, not as zero teams", () => {
    const ctx = sideContext(
      {
        metric: counting,
        ktc: {},
        pickKtc: {},
        superflex: false,
        teams: null,
        adp: {},
        adpBoard: "redraft",
        adpLadder: [],
        adpPool: 108,
        steepness: 4,
      },
      { players: {}, managers: {}, pickSlots: {} },
      "L1",
      bundle(),
    );
    assert.equal(ctx.teams, null);
  });
});

describe("trackLines", () => {
  test("players, then picks, then FAAB — one ordering, keyed per line", () => {
    const lines = trackLines(
      counting,
      context(),
      bundle({ players: ["p1", "p2"], picks: [pick()], faab: 20 }),
    );
    assert.deepEqual(
      lines.map((l) => l.asset.kind),
      ["player", "player", "pick", "faab"],
    );
    assert.equal(new Set(lines.map((l) => l.key)).size, 4);
  });

  test("FAAB is dropped where none moved", () => {
    const lines = trackLines(counting, context(), bundle({ players: ["p1"] }));
    assert.deepEqual(
      lines.map((l) => l.asset.kind),
      ["player"],
    );
  });

  test("a breakdown of one is the total, so one line carries no value", () => {
    const lines = trackLines(counting, context(), bundle({ players: ["p1"] }));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].cell, null);
  });

  test("two covered lines each carry theirs", () => {
    const lines = trackLines(
      counting,
      context(),
      bundle({ players: ["p1", "p2"] }),
    );
    assert.deepEqual(
      lines.map((l) => l.cell?.text),
      ["player", "player"],
    );
  });

  test("counted over lines the metric covers, not over assets", () => {
    // Two assets, one of them a kind this metric has no opinion on — so the
    // breakdown is of one, and neither line draws a number.
    const lines = trackLines(
      playersOnly,
      context(),
      bundle({ players: ["p1"], faab: 30 }),
    );
    assert.equal(lines.length, 2);
    assert.deepEqual(
      lines.map((l) => l.cell),
      [null, null],
    );
  });

  test("an uncovered line stays null even where the track shows values", () => {
    const lines = trackLines(
      playersOnly,
      context(),
      bundle({ players: ["p1", "p2"], faab: 30 }),
    );
    assert.deepEqual(
      lines.map((l) => l.cell?.text ?? null),
      ["p1", "p2", null],
    );
  });

  test("a metric with no per-asset form draws no per-asset column", () => {
    const lines = trackLines(
      totalOnly,
      context(),
      bundle({ players: ["p1", "p2", "p3"] }),
    );
    assert.equal(lines.length, 3);
    assert.ok(lines.every((l) => l.cell === null));
  });

  test("each block is ranked by what the column beside it is worth", () => {
    // Stored back to front — which is how a haul arrives, since `adds` is a map
    // and its iteration order says nothing about the trade.
    const lines = trackLines(
      valued,
      context(),
      bundle({
        players: ["p1", "p2", "p3"],
        picks: [pick({ round: 3 }), pick({ round: 1 }), pick({ round: 2 })],
        faab: 20,
      }),
    );
    assert.deepEqual(lines.map(label), [
      "p2",
      "p3",
      "p1",
      "round 1",
      "round 2",
      "round 3",
      "faab",
    ]);
  });

  test("an unpriced line sinks in its own block, never out of it", () => {
    // A kicker the board has no number for is still a player this side
    // received, so he sorts below the priced players and above the picks.
    const lines = trackLines(
      valued,
      context(),
      bundle({ players: ["unpriced", "p1", "p2"], picks: [pick()] }),
    );
    assert.deepEqual(lines.map(label), ["p2", "p1", "unpriced", "round 1"]);
  });

  test("lines of equal value keep the order they arrived in", () => {
    const stored = bundle({ players: ["tie1", "tie2", "p2"] });
    assert.deepEqual(trackLines(valued, context(), stored).map(label), [
      "p2",
      "tie1",
      "tie2",
    ]);
    // Reversed in, reversed out: the sort is stable, so a tie is not an excuse
    // to shuffle two lines a reader has no way to tell apart.
    const swapped = bundle({ players: ["tie2", "tie1", "p2"] });
    assert.deepEqual(trackLines(valued, context(), swapped).map(label), [
      "p2",
      "tie2",
      "tie1",
    ]);
  });

  test("a metric with no per-asset form ranks nothing", () => {
    // There is no number to rank on, so the stored order is what is left — and
    // the blocks still hold, since those are `bundleAssets`' answer.
    const lines = trackLines(
      totalOnly,
      context(),
      bundle({ players: ["p1", "p2"], picks: [pick({ round: 3 })] }),
    );
    assert.deepEqual(lines.map(label), ["p1", "p2", "round 3"]);
  });

  test("a key stays with its own line when the ranking moves it", () => {
    const stored = bundle({ players: ["p1", "p2"] });
    const [first, second] = trackLines(valued, context(), stored);
    // p2 outranks p1 and is drawn first, still carrying the key of the line it
    // arrived as — so re-aiming the column re-orders the rows rather than
    // handing one row's key to another asset.
    assert.equal(label(first), "p2");
    assert.equal(first.key, assetKey({ kind: "player", id: "p2" }, 1));
    assert.equal(second.key, assetKey({ kind: "player", id: "p1" }, 0));
  });

  test("a line is priced against its own track's haul, not the side's take", () => {
    // The give track passes the side's context and its *own* bundle; a metric
    // reading `received` must see the bundle it was handed, or every give line
    // is priced against what the side took instead.
    const seen: TradeBundle[] = [];
    const spy: TradeMetric = {
      ...counting,
      asset: (ctx, asset) => {
        seen.push(ctx.received);
        return { text: asset.kind, value: null, title: "" };
      },
    };
    const take = bundle({ players: ["p1"] });
    const give = bundle({ players: ["p2", "p3"] });

    trackLines(spy, context({ received: take }), give);
    assert.ok(seen.length > 0);
    assert.ok(seen.every((b) => b === give));
  });
});

describe("where a side is cut, and how wide it sits", () => {
  /**
   * **These two exist to be shared, so what is pinned here is the agreement.**
   * The sides grid draws them and the pre-trade rosters draw the same grid
   * underneath it; a cut that fell in one row and not the one directly below it
   * reads as a rendering fault rather than as a layout. They were a ternary
   * inline in the card until there were two call sites for it.
   */

  test("the first side is cut off nothing", () => {
    assert.equal(sideSeam(0), "");
  });

  test("a side in the trailing column is cut on its leading edge", () => {
    // Vertical from `sm` up — below it the sides stack, which is why the class
    // carries the horizontal cut too.
    assert.equal(sideSeam(1), SIDE_SEAM_COLUMN);
    assert.equal(sideSeam(3), SIDE_SEAM_COLUMN);
  });

  test("a side that starts a row is cut along its top", () => {
    assert.equal(sideSeam(2), SIDE_SEAM_ROW);
    assert.equal(sideSeam(4), SIDE_SEAM_ROW);
  });

  test("only the odd side of an odd-sided trade spans the row", () => {
    // The two-sided card, which is nearly every trade: neither side is wide.
    assert.equal(sideSpansRow(0, 2), false);
    assert.equal(sideSpansRow(1, 2), false);

    // The three-way: the last one takes the whole row rather than leaving the
    // cell beside it empty, which would read as a participant who came away
    // with nothing — a real state the card draws in words instead.
    assert.equal(sideSpansRow(0, 3), false);
    assert.equal(sideSpansRow(1, 3), false);
    assert.equal(sideSpansRow(2, 3), true);

    // Four sides pair up evenly again.
    assert.equal(sideSpansRow(3, 4), false);
  });

  test("a wide side is always one that starts a row, so its cut is horizontal", () => {
    // The two are read together at both call sites, and this is the pairing that
    // has to hold: a side spanning both columns sits under both of them, so a
    // vertical cut on its leading edge would be a line to nowhere.
    for (const count of [1, 3, 5, 7]) {
      const last = count - 1;
      assert.equal(sideSpansRow(last, count), true);
      if (last > 0) assert.equal(sideSeam(last), SIDE_SEAM_ROW);
    }
  });
});
