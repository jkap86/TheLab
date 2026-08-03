import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_TRADE_FILTERS,
  TRADE_CIRCLES,
  activeTradeFilterCount,
  pickLabel,
  pickToken,
  tradeCircleSummary,
  tradeFilterSummary,
  tradeRangeBounds,
} from "./filters.ts";
import type { TradeFilters } from "./filters.ts";

const filters = (over: Partial<TradeFilters> = {}): TradeFilters => ({
  ...DEFAULT_TRADE_FILTERS,
  ...over,
});

/** An unbounded window — both halves open. */
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

  test("a circle is one narrowing, and the widest one is none", () => {
    // The trigger's badge is the only thing outside the dialog that says a
    // circle is on, so a circle that didn't reach this count would be a board
    // narrowed to one account with nothing on screen admitting it.
    assert.equal(activeTradeFilterCount(filters({ circle: "all" })), 0);
    assert.equal(activeTradeFilterCount(filters({ circle: "mine" })), 1);
    assert.equal(
      activeTradeFilterCount(
        filters({ circle: "leaguemate-leagues", players: ["a"] }),
      ),
      2,
    );
  });
});

describe("the circles", () => {
  test("every circle is named, in words that read mid-sentence", () => {
    // The page's scope line is `season · circle · league rules · trade
    // filters`, so a missing summary would read as a stray separator rather
    // than as a filter with no name.
    for (const circle of TRADE_CIRCLES) {
      const summary = tradeCircleSummary(circle.value);
      assert.ok(summary.length > 0, circle.value);
      assert.equal(summary, summary.toLowerCase(), circle.value);
    }
  });

  test("the default is the whole market", () => {
    // The page's premise: the leagues a reader plays in are a fraction of the
    // trades worth reading, and this page opens on all of them.
    assert.equal(DEFAULT_TRADE_FILTERS.circle, "all");
    assert.equal(TRADE_CIRCLES[0].value, "all");
  });
});

describe("pick tokens", () => {
  test("a token is a season and a round, and reads back as an ordinal", () => {
    assert.equal(pickToken({ season: "2026", round: 1 }), "2026-1");
    assert.equal(pickLabel("2026-1"), "2026 1st");
    assert.equal(pickLabel("2027-3"), "2027 3rd");
  });

  // The origin roster is deliberately not in the token: "a 2026 1st" is the
  // asset a reader looks for, and splitting it twelve ways by whose it was
  // would make the filter list unreadable. Which side it landed on is the
  // trade's own display.
  test("the originating roster is not part of the token", () => {
    assert.equal(
      pickToken({ season: "2026", round: 2, roster_id: 7 } as never),
      "2026-2",
    );
  });
});
