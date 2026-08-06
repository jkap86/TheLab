import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PICK_TOKEN_SQL } from "../../shared/trades/sql.ts";
import {
  DEFAULT_TRADE_FILTERS,
  DEFAULT_TRADE_RANGE,
  EMPTY_SIDE,
  TRADE_CIRCLES,
  TRADE_RANGE_PRESETS,
  activeTradeFilterCount,
  pickLabel,
  pickToken,
  setSideManager,
  swapSides,
  toggleSideAsset,
  tradeCircleSummary,
  tradeFilterSummary,
  tradeRangeBounds,
  tradeRangeLabel,
} from "./filters.ts";
import type {
  TradeFilters,
  TradeNames,
  TradeRange,
  TradeSideFilter,
} from "./filters.ts";

const filters = (over: Partial<TradeFilters> = {}): TradeFilters => ({
  ...DEFAULT_TRADE_FILTERS,
  ...over,
});

/** A bay, with only what the case under test cares about spelled out. */
const side = (over: Partial<TradeSideFilter> = {}): TradeSideFilter => ({
  ...EMPTY_SIDE,
  ...over,
});

/**
 * The page's own lookups, as the summary sees them: two ids it can name and
 * everything else falling through to itself.
 */
const NAMES: TradeNames = {
  player: (id) => (id === "p1" ? "Malik Nabers" : id),
  manager: (id) =>
    id === "u1" ? "jkap" : id === "u2" ? "DarksideEmperors" : id,
};

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
    assert.equal(tradeFilterSummary(DEFAULT_TRADE_FILTERS, NAMES), "all time");
  });

  test("reads the bays out rather than counting them", () => {
    // The whole point of the sides: "all of 1 manager, 1 player" described the
    // shape of a selection where this describes the question.
    assert.equal(
      tradeFilterSummary(
        filters({
          range: { preset: "30d", from: null, to: null },
          sides: [side({ manager: "u1" }), side({ players: ["p1"] })],
        }),
        NAMES,
      ),
      "last 30 days · jkap gave Malik Nabers",
    );
  });

  test("a manager on each side is two clauses, each under its own name", () => {
    assert.equal(
      tradeFilterSummary(
        filters({
          sides: [
            side({ manager: "u1", players: ["p1"] }),
            side({ manager: "u2", picks: ["2027-1"] }),
          ],
        }),
        NAMES,
      ),
      "all time · jkap got Malik Nabers · DarksideEmperors got 2027 1st",
    );
  });

  test("with nobody named the sides are named by their places", () => {
    assert.equal(
      tradeFilterSummary(
        filters({
          sides: [side({ players: ["p1"] }), side({ picks: ["2027-1"] })],
        }),
        NAMES,
      ),
      "all time · one side got Malik Nabers · the other side got 2027 1st",
    );
  });

  test("managers with no assets are a sentence about the people", () => {
    // Naming the bays here would be describing sides that hold nothing.
    assert.equal(
      tradeFilterSummary(filters({ sides: [side({ manager: "u1" }), EMPTY_SIDE] }), NAMES),
      "all time · jkap traded",
    );
    assert.equal(
      tradeFilterSummary(
        filters({ sides: [side({ manager: "u1" }), side({ manager: "u2" })] }),
        NAMES,
      ),
      "all time · jkap traded with DarksideEmperors",
    );
  });

  test("the mode joins the assets inside a bay", () => {
    const both = filters({
      sides: [side({ players: ["p1"], picks: ["2027-1"] }), EMPTY_SIDE],
    });
    assert.match(tradeFilterSummary(both, NAMES), /Malik Nabers and 2027 1st/);
    assert.match(
      tradeFilterSummary({ ...both, match: "any" }, NAMES),
      /Malik Nabers or 2027 1st/,
    );
  });

  test("an unresolved id is the id, never a count", () => {
    // The board's maps only carry what its loaded pages named, and a summary
    // reading "1 player" beside a bay drawing a name was the old shape's tell.
    assert.match(
      tradeFilterSummary(filters({ sides: [side({ players: ["p9"] }), EMPTY_SIDE] }), NAMES),
      /p9/,
    );
  });
});

describe("the side mutations", () => {
  test("an asset moves between bays rather than being held by both", () => {
    // Both sides receiving one player is unsatisfiable, so honouring it
    // literally would empty the board with nothing on screen saying why.
    const left = toggleSideAsset(DEFAULT_TRADE_FILTERS, 0, "player", "p1");
    const moved = toggleSideAsset(left, 1, "player", "p1");
    assert.deepEqual(moved.sides[0].players, []);
    assert.deepEqual(moved.sides[1].players, ["p1"]);
  });

  test("toggling an asset in its own bay takes it out", () => {
    const left = toggleSideAsset(DEFAULT_TRADE_FILTERS, 0, "player", "p1");
    assert.deepEqual(toggleSideAsset(left, 0, "player", "p1").sides[0].players, []);
  });

  test("a manager moves too, for a sharper reason", () => {
    // Naming one person on both sides asks for a trade they made with
    // themselves.
    const left = setSideManager(DEFAULT_TRADE_FILTERS, 0, "u1");
    const moved = setSideManager(left, 1, "u1");
    assert.equal(moved.sides[0].manager, null);
    assert.equal(moved.sides[1].manager, "u1");
  });

  test("swapping is the two bays, exchanged", () => {
    const set = filters({
      sides: [side({ manager: "u1" }), side({ players: ["p1"] })],
    });
    const swapped = swapSides(set);
    assert.deepEqual(swapped.sides[0], set.sides[1]);
    assert.deepEqual(swapped.sides[1], set.sides[0]);
  });
});

describe("activeTradeFilterCount", () => {
  test("counts each thing named and a bounded window as one", () => {
    assert.equal(activeTradeFilterCount(DEFAULT_TRADE_FILTERS), 0);
    assert.equal(
      activeTradeFilterCount(
        filters({
          range: { preset: "30d", from: null, to: null },
          sides: [side({ manager: "u1", players: ["a", "b"] }), EMPTY_SIDE],
        }),
      ),
      4,
    );
  });

  test("a named manager counts wherever the bay is", () => {
    // Both are one thing the reader picked, however differently the two are
    // stored — a bay saying "jkap got Nabers" is two narrowings.
    assert.equal(
      activeTradeFilterCount(
        filters({ sides: [EMPTY_SIDE, side({ manager: "u1" })] }),
      ),
      1,
    );
  });

  test("a circle is one narrowing, and the widest one is none", () => {
    // The trigger's badge is the only thing outside the panel that says a
    // circle is on, so a circle that didn't reach this count would be a board
    // narrowed to one account with nothing on screen admitting it.
    assert.equal(activeTradeFilterCount(filters({ circle: "all" })), 0);
    assert.equal(activeTradeFilterCount(filters({ circle: "mine" })), 1);
    assert.equal(
      activeTradeFilterCount(
        filters({
          circle: "leaguemate-leagues",
          sides: [side({ players: ["a"] }), EMPTY_SIDE],
        }),
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
