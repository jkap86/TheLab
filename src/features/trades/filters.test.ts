import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Trade, TradeSide } from "@/shared/trades";

import {
  DEFAULT_TRADE_FILTERS,
  activeTradeFilterCount,
  pickLabel,
  tradeFilterSummary,
  tradeMatches,
  tradeOptions,
  tradeRangeBounds,
} from "./filters.ts";
import type { TradeFilters } from "./filters.ts";

const side = (
  roster_id: number,
  over: Partial<TradeSide> = {},
): TradeSide => ({
  roster_id,
  user_id: `user${roster_id}`,
  players: [],
  picks: [],
  faab: 0,
  ...over,
});

const trade = (over: Partial<Trade> = {}): Trade => ({
  transaction_id: "t1",
  league_id: "l1",
  week: 2,
  completed_at: Date.parse("2026-07-15T12:00:00Z"),
  sides: [side(1), side(2)],
  ...over,
});

const filters = (over: Partial<TradeFilters> = {}): TradeFilters => ({
  ...DEFAULT_TRADE_FILTERS,
  ...over,
});

const OPEN = { from: null, to: null };

describe("tradeRangeBounds", () => {
  test("a relative preset counts back from today and leaves the end open", () => {
    const bounds = tradeRangeBounds(
      { preset: "7d", from: null, to: null },
      "2026-07-31",
    );
    // Seven days *including* today, so the window opens on the 25th.
    assert.equal(bounds.from, Date.parse("2026-07-25T00:00:00"));
    assert.equal(bounds.to, null);
  });

  test("all time bounds nothing", () => {
    assert.deepEqual(
      tradeRangeBounds({ preset: "all", from: null, to: null }, "2026-07-31"),
      OPEN,
    );
  });

  test("a custom end includes the named day whole", () => {
    const bounds = tradeRangeBounds(
      { preset: "custom", from: "2026-06-01", to: "2026-06-30" },
      "2026-07-31",
    );
    assert.equal(bounds.from, Date.parse("2026-06-01T00:00:00"));
    // Exclusive at the next midnight — a trade at 23:59 on the 30th is in.
    assert.equal(bounds.to, Date.parse("2026-07-01T00:00:00"));
  });

  test("a custom range with one open end stays open on that side", () => {
    const bounds = tradeRangeBounds(
      { preset: "custom", from: "2026-06-01", to: null },
      "2026-07-31",
    );
    assert.equal(bounds.to, null);
  });
});

describe("tradeMatches", () => {
  test("no selection matches everything in the window", () => {
    assert.equal(tradeMatches(trade(), filters(), OPEN), true);
  });

  test("a bound drops a trade Sleeper gave no timestamp", () => {
    const undated = trade({ completed_at: null });
    assert.equal(tradeMatches(undated, filters(), OPEN), true);
    assert.equal(
      tradeMatches(undated, filters(), { from: 0, to: null }),
      false,
    );
  });

  test("a player matches whichever side he landed on", () => {
    const t = trade({ sides: [side(1, { players: ["4034"] }), side(2)] });
    const f = filters({ players: ["4034"] });

    assert.equal(tradeMatches(t, f, OPEN), true);
    // The same trade read from the other direction — the filter asks what moved,
    // not who received it.
    const flipped = trade({ sides: [side(1), side(2, { players: ["4034"] })] });
    assert.equal(tradeMatches(flipped, f, OPEN), true);
  });

  test("`all` needs every selection, across categories", () => {
    const t = trade({
      sides: [
        side(1, { players: ["4034"] }),
        side(2, { picks: [{ season: "2026", round: 1, roster_id: 1 }] }),
      ],
    });

    assert.equal(
      tradeMatches(t, filters({ players: ["4034"], picks: ["2026-1"] }), OPEN),
      true,
    );
    assert.equal(
      tradeMatches(
        t,
        filters({ players: ["4034"], managers: ["user9"] }),
        OPEN,
      ),
      false,
    );
  });

  test("`any` needs one of them", () => {
    const t = trade({ sides: [side(1, { players: ["4034"] }), side(2)] });
    const f = filters({
      match: "any",
      players: ["4034"],
      managers: ["user9"],
    });

    assert.equal(tradeMatches(t, f, OPEN), true);
  });

  test("the window narrows regardless of match mode", () => {
    // `any` widens the *selection*, never the dates — the bound is not one of
    // the alternatives.
    const t = trade({ completed_at: Date.parse("2026-01-01T00:00:00Z") });
    const f = filters({ match: "any", players: ["4034"] });

    assert.equal(
      tradeMatches(t, f, { from: Date.parse("2026-06-01T00:00:00Z"), to: null }),
      false,
    );
  });
});

describe("tradeOptions", () => {
  test("counts trades per value, busiest first", () => {
    const trades = [
      trade({ sides: [side(1, { players: ["a"] }), side(2, { players: ["b"] })] }),
      trade({ sides: [side(1, { players: ["a"] }), side(3)] }),
    ];

    assert.deepEqual(
      tradeOptions(trades, "players", (id) => ({ label: id.toUpperCase() })),
      [
        { value: "a", label: "A", count: 2 },
        { value: "b", label: "B", count: 1 },
      ],
    );
  });

  test("a value appearing twice in one trade counts once", () => {
    // Both sides of a three-way can name the same manager only once, but a
    // player and a pick of the same round can appear on both sides.
    const trades = [
      trade({
        sides: [
          side(1, { picks: [{ season: "2026", round: 1, roster_id: 2 }] }),
          side(2, { picks: [{ season: "2026", round: 1, roster_id: 1 }] }),
        ],
      }),
    ];

    assert.deepEqual(
      tradeOptions(trades, "picks", (token) => ({ label: pickLabel(token) })),
      [{ value: "2026-1", label: "2026 1st", count: 1 }],
    );
  });
});

describe("tradeFilterSummary", () => {
  test("names the window alone when nothing is selected", () => {
    assert.equal(tradeFilterSummary(DEFAULT_TRADE_FILTERS), "all time");
  });

  test("names the match mode and each category it applies to", () => {
    assert.equal(
      tradeFilterSummary(
        filters({
          range: { preset: "30d", from: null, to: null },
          managers: ["a", "b"],
          picks: ["2026-1"],
          match: "any",
        }),
      ),
      "last 30 days · any of 2 managers, 1 pick",
    );
  });
});

describe("activeTradeFilterCount", () => {
  test("counts each selection and a bounded window as one", () => {
    assert.equal(activeTradeFilterCount(DEFAULT_TRADE_FILTERS), 0);
    assert.equal(
      activeTradeFilterCount(
        filters({
          range: { preset: "30d", from: null, to: null },
          players: ["a", "b"],
          managers: ["c"],
        }),
      ),
      4,
    );
  });
});
