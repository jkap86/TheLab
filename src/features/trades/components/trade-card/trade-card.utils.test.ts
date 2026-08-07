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
  assetKey,
  formatTradeDate,
  formatTradeTime,
  pickOwnerLabel,
  sideContext,
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
  ...over,
});

/** A metric that reads every line, so the show/hide rule is what is on trial. */
const counting: TradeMetric = {
  key: "test",
  group: "Test",
  label: "Test",
  cell: () => ({ kind: "value", text: "total", title: "the total" }),
  asset: (_ctx, asset) => ({ text: asset.kind, title: asset.kind }),
};

/** One that covers players only — the "not covered" half of the two nulls. */
const playersOnly: TradeMetric = {
  ...counting,
  asset: (_ctx, asset) =>
    asset.kind === "player" ? { text: asset.id, title: asset.id } : null,
};

/** And one with no per-asset form at all, like every count in the catalogue. */
const totalOnly: TradeMetric = { ...counting, asset: undefined };

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

  test("a 12-hour clock with its own separator", () => {
    assert.equal(formatTradeTime(at(15, 7)), " · 3:07 PM");
    assert.equal(formatTradeTime(at(9, 30)), " · 9:30 AM");
  });

  test("both noons read as 12, never as 0", () => {
    assert.equal(formatTradeTime(at(0, 5)), " · 12:05 AM");
    assert.equal(formatTradeTime(at(12, 5)), " · 12:05 PM");
  });

  test("minutes are zero-padded, so the column stays a column", () => {
    assert.equal(formatTradeTime(at(1, 1)), " · 1:01 AM");
  });

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
          redraft: null,
          dynasty: { picks: 12, adp: 16, min_pick: 8, max_pick: 30, stdev: 4 },
        },
      },
      adpBoard: "dynasty",
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

  test("a line is priced against its own track's haul, not the side's take", () => {
    // The give track passes the side's context and its *own* bundle; a metric
    // reading `received` must see the bundle it was handed, or every give line
    // is priced against what the side took instead.
    const seen: TradeBundle[] = [];
    const spy: TradeMetric = {
      ...counting,
      asset: (ctx, asset) => {
        seen.push(ctx.received);
        return { text: asset.kind, title: "" };
      },
    };
    const take = bundle({ players: ["p1"] });
    const give = bundle({ players: ["p2", "p3"] });

    trackLines(spy, context({ received: take }), give);
    assert.ok(seen.length > 0);
    assert.ok(seen.every((b) => b === give));
  });
});
