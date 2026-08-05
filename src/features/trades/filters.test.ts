import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PICK_TOKEN_SQL } from "../../shared/trades/sql.ts";
import {
  DEFAULT_TRADE_FILTERS,
  DEFAULT_TRADE_RANGE,
  TRADE_CIRCLES,
  TRADE_RANGE_PRESETS,
  activeTradeFilterCount,
  pickLabel,
  pickToken,
  tradeCircleSummary,
  tradeFilterSummary,
  tradeRangeBounds,
  tradeRangeLabel,
} from "./filters.ts";
import type { TradeFilters, TradeRange } from "./filters.ts";

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

  test("a custom range with neither end set bounds nothing", () => {
    // What the two date inputs read as before either is filled — an unbounded
    // window rather than a window of zero width.
    assert.deepEqual(
      tradeRangeBounds({ preset: "custom", ...OPEN }, "2026-07-31"),
      OPEN,
    );
  });

  test("an unparseable start reads as an open end, never as NaN", () => {
    // `NaN` as a bound compares false against every trade, which would empty the
    // board with nothing on screen to say why — so the guard reads it as "not
    // set". The control is a native date input and only ever emits `""` or a
    // real date, so this is the belt behind the braces rather than a live path.
    assert.deepEqual(
      tradeRangeBounds({ preset: "custom", from: "not a date", to: null }, "2026-07-31"),
      OPEN,
    );
  });

  test("each relative preset is longer than the one before it", () => {
    // They are one scale, so a reader stepping out through them widens the
    // board every time — the day counts are off by one from their names on
    // purpose (seven days *including* today), which is easy to fix into a bug.
    const today = "2026-07-31";
    const from = (preset: TradeRange["preset"]) =>
      tradeRangeBounds({ preset, ...OPEN }, today).from!;
    assert.ok(from("7d") > from("30d"));
    assert.ok(from("30d") > from("90d"));
    assert.equal(tradeRangeBounds({ preset: "all", ...OPEN }, today).from, null);
  });

  test("the default window is the whole market", () => {
    // The page opens unnarrowed, which is what makes the circle the thing that
    // narrows it back to a reader's own leagues.
    assert.equal(DEFAULT_TRADE_RANGE.preset, "all");
    assert.deepEqual(tradeRangeBounds(DEFAULT_TRADE_RANGE, "2026-07-31"), OPEN);
  });
});

describe("tradeRangeLabel", () => {
  test("a preset keeps its name, so it stays true as time passes", () => {
    assert.equal(tradeRangeLabel({ preset: "7d", ...OPEN }), "Last 7 days");
    assert.equal(tradeRangeLabel({ preset: "all", ...OPEN }), "All time");
  });

  test("every offered preset has a name to be read by", () => {
    // The lookup is a `find(...)!`, so a preset added to the type and not to the
    // table is a crash on the trigger rather than a compiler error.
    for (const { value } of TRADE_RANGE_PRESETS) {
      assert.equal(typeof tradeRangeLabel({ preset: value, ...OPEN }), "string");
    }
  });

  test("a custom window spells out the ends it has", () => {
    assert.equal(
      tradeRangeLabel({ preset: "custom", from: "2026-06-01", to: "2026-06-30" }),
      "2026-06-01 – 2026-06-30",
    );
    assert.equal(
      tradeRangeLabel({ preset: "custom", from: "2026-06-01", to: null }),
      "Since 2026-06-01",
    );
    assert.equal(
      tradeRangeLabel({ preset: "custom", from: null, to: "2026-06-30" }),
      "Through 2026-06-30",
    );
  });

  test("a custom window with neither end says what it does, not 'Custom'", () => {
    // It narrows nothing, and the summary line beside it is read mid-sentence —
    // "custom" there would name the control rather than the board.
    assert.equal(tradeRangeLabel({ preset: "custom", ...OPEN }), "All time");
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

  test("the client writes the token the server's SQL builds", () => {
    // The two ends are a matched pair with no compiler link between them: the
    // client sends these tokens and `tradeFilterSql` compares them against a
    // token it assembles in SQL, so a separator changed on one side matches no
    // trades rather than failing. Read the SQL's own halves back out and build
    // the same token from them.
    const [, left, joiner, right] =
      /\(\(p->>'(\w+)'\) \|\| '(.+)' \|\| \(p->>'(\w+)'\)\)/.exec(PICK_TOKEN_SQL) ?? [];
    const pick = { season: "2026", round: 1 };
    assert.equal(
      `${pick[left as "season"]}${joiner}${pick[right as "round"]}`,
      pickToken(pick),
    );
  });

  test("a round past the teens still reads as an ordinal", () => {
    // Startups run 25 rounds, so the label's exception window is reachable from
    // a real board rather than only from an arithmetic edge.
    assert.equal(pickLabel("2026-11"), "2026 11th");
    assert.equal(pickLabel("2026-21"), "2026 21st");
  });
});
