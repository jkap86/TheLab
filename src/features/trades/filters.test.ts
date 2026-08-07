import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PICK_TOKEN_SQL } from "../../shared/trades/sql.ts";
import {
  DEFAULT_TRADE_FILTERS,
  DEFAULT_TRADE_SEEK,
  EMPTY_SIDE,
  TRADE_CIRCLES,
  activeTradeFilterCount,
  circleIndex,
  pickLabel,
  pickToken,
  setSideManager,
  stepCircle,
  swapSides,
  toggleSideAsset,
  tradeFilterSummary,
  tradeSeekBounds,
} from "./filters.ts";
import type { TradeFilters, TradeNames, TradeSideFilter } from "./filters.ts";

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

describe("tradeSeekBounds", () => {
  test("a seek bounds only the far end, so everything older stays on the board", () => {
    // The board reads newest-first, so a position in it is an upper bound and
    // nothing else — which is what makes the date a place to scroll *from*
    // rather than a slice to look at.
    const bounds = tradeSeekBounds("2026-06-30", "2026-07-31");
    assert.equal(bounds.from, null);
    // Exclusive at the next midnight — a trade at 23:59 on the 30th is in.
    assert.equal(bounds.to, Date.parse("2026-07-01T00:00:00"));
  });

  test("no seek is the whole board, from its newest trade back", () => {
    assert.deepEqual(tradeSeekBounds(null, "2026-07-31"), OPEN);
  });

  test("today bounds nothing, so it is the same board as no seek at all", () => {
    // No trade completes in the future, so the two are one answer — and the
    // control opens showing today while holding null, which only works because
    // picking today explicitly resolves back to the identical bounds rather than
    // to a second cache entry.
    assert.deepEqual(tradeSeekBounds("2026-07-31", "2026-07-31"), OPEN);
  });

  test("a date past today bounds nothing either", () => {
    // Unreachable through the control, which caps its own `max` at today — this
    // is the belt behind that, since a stale bookmark or a clock rolling over
    // between renders can produce one.
    assert.deepEqual(tradeSeekBounds("2027-01-01", "2026-07-31"), OPEN);
  });

  test("an unparseable date reads as an unpositioned board, never as an empty one", () => {
    // `NaN` as a bound compares false against every trade, which would clear the
    // list with nothing on screen to say why. The shift is also what would throw
    // on an unreadable date, so the parse has to come first.
    assert.deepEqual(tradeSeekBounds("2026-13-45", "2026-12-31"), OPEN);
    assert.deepEqual(tradeSeekBounds("not a date", "2026-07-31"), OPEN);
  });

  test("an earlier seek reaches further back than a later one", () => {
    const to = (seek: string) => tradeSeekBounds(seek, "2026-07-31").to!;
    assert.ok(to("2026-05-01") < to("2026-06-01"));
    assert.ok(to("2026-06-01") < to("2026-07-30"));
  });

  test("the seek crosses a month end without rolling the day", () => {
    // The bound is the *next* day's midnight, and the shift is what has to know
    // that June has thirty of them.
    assert.equal(
      tradeSeekBounds("2026-06-30", "2026-07-31").to,
      Date.parse("2026-07-01T00:00:00"),
    );
    assert.equal(
      tradeSeekBounds("2026-02-28", "2026-07-31").to,
      Date.parse("2026-03-01T00:00:00"),
    );
  });

  test("the board opens at its newest trades", () => {
    // The page opens unnarrowed and unpositioned, which is what makes the circle
    // the thing that narrows it back to a reader's own leagues.
    assert.equal(DEFAULT_TRADE_SEEK, null);
    assert.equal(DEFAULT_TRADE_FILTERS.seek, null);
    assert.deepEqual(tradeSeekBounds(DEFAULT_TRADE_SEEK, "2026-07-31"), OPEN);
  });
});

describe("tradeFilterSummary", () => {
  test("says nothing at all when neither bay does", () => {
    // Null rather than a phrase, so the scope line it is joined into doesn't
    // carry a separator with nothing after it — and so what it *used* to lead
    // with can't creep back: the window and the circle are keys on the page now,
    // and a line restating a lit control is what this stopped doing.
    assert.equal(tradeFilterSummary(DEFAULT_TRADE_FILTERS, NAMES), null);
    assert.equal(tradeFilterSummary(filters({ circle: "mine" }), NAMES), null);
    assert.equal(
      tradeFilterSummary(filters({ seek: "2026-06-30" }), NAMES),
      null,
    );
  });

  test("reads the bays out rather than counting them", () => {
    // The whole point of the sides: "all of 1 manager, 1 player" described the
    // shape of a selection where this describes the question.
    assert.equal(
      tradeFilterSummary(
        filters({
          sides: [side({ manager: "u1" }), side({ players: ["p1"] })],
        }),
        NAMES,
      ),
      "jkap gave Malik Nabers",
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
      "jkap got Malik Nabers · DarksideEmperors got 2027 1st",
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
      "one side got Malik Nabers · the other side got 2027 1st",
    );
  });

  test("managers with no assets are a sentence about the people", () => {
    // Naming the bays here would be describing sides that hold nothing.
    assert.equal(
      tradeFilterSummary(filters({ sides: [side({ manager: "u1" }), EMPTY_SIDE] }), NAMES),
      "jkap traded",
    );
    assert.equal(
      tradeFilterSummary(
        filters({ sides: [side({ manager: "u1" }), side({ manager: "u2" })] }),
        NAMES,
      ),
      "jkap traded with DarksideEmperors",
    );
  });

  test("the mode joins the assets inside a bay", () => {
    const both = filters({
      sides: [side({ players: ["p1"], picks: ["2027-1"] }), EMPTY_SIDE],
    });
    assert.match(tradeFilterSummary(both, NAMES)!, /Malik Nabers and 2027 1st/);
    assert.match(
      tradeFilterSummary({ ...both, match: "any" }, NAMES)!,
      /Malik Nabers or 2027 1st/,
    );
  });

  test("an unresolved id is the id, never a count", () => {
    // The board's maps only carry what its loaded pages named, and a summary
    // reading "1 player" beside a bay drawing a name was the old shape's tell.
    assert.match(
      tradeFilterSummary(filters({ sides: [side({ players: ["p9"] }), EMPTY_SIDE] }), NAMES)!,
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
  test("counts each thing named and a seek as one", () => {
    assert.equal(activeTradeFilterCount(DEFAULT_TRADE_FILTERS), 0);
    assert.equal(
      activeTradeFilterCount(
        filters({
          seek: "2026-06-30",
          sides: [side({ manager: "u1", players: ["a", "b"] }), EMPTY_SIDE],
        }),
      ),
      4,
    );
  });

  test("a seek counts, and the newest board is none", () => {
    // It is a position rather than a filter, but everything newer than the date
    // is off the board while it is set — and `Clear` is drawn against this
    // count, so a seek that didn't reach it would leave a reader who travelled
    // back in April with no one control that puts them at the top again.
    assert.equal(activeTradeFilterCount(filters({ seek: null })), 0);
    assert.equal(activeTradeFilterCount(filters({ seek: "2026-06-30" })), 1);
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
    // The keys are on the page and say for themselves which circle is on; what
    // this count decides is whether `Clear` is drawn, so a circle that didn't
    // reach it would be a board narrowed to one account with no way back to the
    // whole market but pressing the widest key by hand.
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
  test("every circle carries the sentence the readout cannot say", () => {
    // The instrument prints `label` and that is all a readout has room for;
    // `note` is what separates the two leaguemate readings — who was *dealing*
    // against where the deal *happened* — and the caption under it reads that
    // out of a `find(...)!`, so a circle added to the type and not to this table
    // is a crash on the control rather than a compiler error.
    for (const circle of TRADE_CIRCLES) {
      assert.ok(circle.label.length > 0, circle.value);
      assert.ok(circle.note.length > 0, circle.value);
    }
  });

  test("the default is the whole market, and it is the widest rung", () => {
    // The page's premise: the leagues a reader plays in are a fraction of the
    // trades worth reading, and this page opens on all of them.
    assert.equal(DEFAULT_TRADE_FILTERS.circle, "all");
    assert.equal(TRADE_CIRCLES[TRADE_CIRCLES.length - 1].value, "all");
  });

  test("the table is in radius order, narrowest first", () => {
    // The ordering *is* the control: `‹` and `›` walk this array, and the pips
    // count along it, so a table in any other order is a stepper that widens by
    // narrowing. It is also the type's own claim — `mine ⊆ leaguemates ⊆
    // leaguemate-leagues ⊆ all` — written down somewhere a test can read it.
    assert.deepEqual(
      TRADE_CIRCLES.map((circle) => circle.value),
      ["mine", "leaguemates", "leaguemate-leagues", "all"],
    );
    TRADE_CIRCLES.forEach((circle, at) => {
      assert.equal(circleIndex(circle.value), at, circle.value);
    });
  });

  test("stepping walks the ladder and stops at both ends", () => {
    assert.equal(stepCircle("mine", 1, true), "leaguemates");
    assert.equal(stepCircle("leaguemates", 1, true), "leaguemate-leagues");
    assert.equal(stepCircle("leaguemate-leagues", 1, true), "all");
    assert.equal(stepCircle("all", -1, true), "leaguemate-leagues");

    // Null rather than clamping, because the control draws the difference: a key
    // that re-selects the circle already showing is a press that appears to do
    // nothing, where an unlit one says the board cannot be widened past every
    // league or narrowed past your own.
    assert.equal(stepCircle("all", 1, true), null);
    assert.equal(stepCircle("mine", -1, true), null);
  });

  test("with no account stored the ladder is one rung", () => {
    // Every circle but the widest is drawn around a Sleeper account, so with
    // none there is nowhere to step from anywhere — including from a circle a
    // stored state might still be holding. The rule lives here rather than at
    // the control because the control has two keys and four values, so what it
    // can ask is "can I move", not "is this one allowed".
    for (const { value } of TRADE_CIRCLES) {
      assert.equal(stepCircle(value, 1, false), null, value);
      assert.equal(stepCircle(value, -1, false), null, value);
    }
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
