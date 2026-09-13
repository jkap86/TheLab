import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  menuSummary,
  heldStatRows,
  narrowStatRows,
  parseStatBasis,
  rankStatRows,
  statFiltersActive,
  statPoints,
  statRows,
  statTagLine,
  statTags,
  statTeams,
  toggleFilterValue,
  topStatRow,
  DEFAULT_STAT_SORT,
  NO_STAT_FILTERS,
  STAT_POSITIONS,
  STAT_COLUMNS,
  STAT_FIXED,
  STAT_SORTS,
  statColumns,
  statFamilies,
  statGroupSpans,
  statScoring,
  statTouchdowns,
  statTrackWidth,
  statYards,
  playerLeagueScope,
  PLAYER_READINGS,
  READING_LABEL,
  readingCount,
  usageLeagueScope,
  usageSummary,
  USAGE_CHIP,
  USAGE_COUNT,
  USAGE_KEYS,
  USAGE_LABEL,
} from "./stat-board.ts";
import type { StatRow, StatSortKey } from "./stat-board.ts";
import type { GametimeGame, GametimeStatLine, StatBoardPosition } from "@/shared/contract";

/**
 * The Player Scores list's arithmetic.
 *
 * Every rule here draws a perfectly ordinary list when it is wrong — a
 * plausible name against a plausible figure in a plausible order — which is
 * why it is driven rather than eyeballed.
 */

function line(over: Partial<GametimeStatLine> = {}): GametimeStatLine {
  return {
    player_id: "1",
    name: "A Player",
    position: "WR",
    team: "CIN",
    pass_yd: 0,
    pass_td: 0,
    pass_int: 0,
    rush_yd: 0,
    rush_td: 0,
    rec: 0,
    rec_yd: 0,
    rec_td: 0,
    fumbles_lost: 0,
    ...over,
  };
}

function game(over: Partial<GametimeGame> = {}): GametimeGame {
  return {
    phase: "final",
    remaining: 0,
    quarter: null,
    clock: null,
    overtime: false,
    kickoff: null,
    opponent: "PIT",
    home: false,
    score: null,
    ...over,
  };
}

function row(over: Partial<StatRow> = {}): StatRow {
  return {
    ...line(),
    opponent: "@PIT",
    clock: { text: "Final", live: false },
    points: 0,
    // Nobody in the reader's leagues, which is what a row is until the fold
    // has something to join onto it.
    held: false,
    start: null,
    bench: null,
    oppStart: null,
    oppBench: null,
    against: null,
    ...over,
  };
}

/** A row the fold answered for — held, with the three counts as given. */
function mine(
  over: Partial<StatRow> & { start: number; bench: number; against: number },
): StatRow {
  // The two opposing counts default to the summed one on the left, so a case
  // that only cares about `against` still produces a row whose four counts
  // reconcile — which is what `statTags` reads.
  return row({ held: true, oppStart: over.against, oppBench: 0, ...over });
}

describe("statPoints", () => {
  test("prices a passing line the standard way", () => {
    const stat = line({ pass_yd: 250, pass_td: 2, pass_int: 1, rush_yd: 30, rush_td: 1 });
    // 10 + 8 - 2 + 3 + 6
    assert.equal(statPoints(stat, "ppr"), 25);
  });

  test("the basis is the reception and nothing else", () => {
    const stat = line({ rec: 8, rec_yd: 90, rec_td: 1 });
    assert.equal(statPoints(stat, "ppr"), 23);
    assert.equal(statPoints(stat, "half"), 19);
    assert.equal(statPoints(stat, "std"), 15);
  });

  test("a lost fumble is minus two, and a week can be negative", () => {
    assert.equal(statPoints(line({ fumbles_lost: 1 }), "ppr"), -2);
  });

  test("rounds to the one decimal the column prints", () => {
    assert.equal(statPoints(line({ pass_yd: 261 }), "ppr"), 10.4);
  });
});

describe("parseStatBasis", () => {
  test("an unreadable basis is PPR, never a third scale", () => {
    assert.equal(parseStatBasis("half"), "half");
    assert.equal(parseStatBasis("std"), "std");
    assert.equal(parseStatBasis("nonsense"), "ppr");
    assert.equal(parseStatBasis(undefined), "ppr");
  });
});

describe("statRows", () => {
  const lines = {
    a: line({ player_id: "a", team: "CIN", rec: 5, rec_yd: 60 }),
    b: line({ player_id: "b", team: "BUF", rush_yd: 40 }),
  };

  test("an away game prints its opponent with an at-sign and a home one bare", () => {
    const rows = statRows(lines, {
      CIN: game({ opponent: "BAL", home: false }),
      BUF: game({ opponent: "NYJ", home: true }),
    }, "ppr");
    assert.deepEqual(
      rows.map((r) => r.opponent),
      ["@BAL", "NYJ"],
    );
  });

  test("the clock is the seat rows' own reading, live and all", () => {
    const rows = statRows(
      { a: lines.a },
      { CIN: game({ phase: "live", quarter: 3, clock: "08:41" }) },
      "ppr",
    );
    assert.deepEqual(rows[0].clock, { text: "Q3 08:41", live: true });
  });

  test("a team with no game on the board is a bye, and prints nothing", () => {
    const rows = statRows({ a: lines.a }, {}, "ppr");
    assert.equal(rows[0].opponent, null);
    assert.equal(rows[0].clock.text, "");
  });

  test("a row the feed gave no team still joins nothing and still prices", () => {
    const rows = statRows({ a: line({ team: null, rec: 4 }) }, { CIN: game() }, "ppr");
    assert.equal(rows[0].opponent, null);
    assert.equal(rows[0].points, 4);
  });
});

describe("the join onto the reader's own week", () => {
  const lines = { a: line({ player_id: "a" }), b: line({ player_id: "b" }) };
  const shares = {
    a: { started: 7, benched: 1, oppStarted: 3, oppBenched: 2 },
  };

  test("a joined row carries the three counts, the opposing pair summed", () => {
    const [a] = statRows(lines, {}, "ppr", shares);
    assert.equal(a.held, true);
    assert.equal(a.start, 7);
    assert.equal(a.bench, 1);
    // **One figure for both opposing readings** — see `StatRow.against`.
    assert.equal(a.against, 5);
  });

  test("a player nobody in the reader's leagues has carries three nulls", () => {
    const [, b] = statRows(lines, {}, "ppr", shares);
    assert.equal(b.held, false);
    assert.deepEqual([b.start, b.bench, b.against], [null, null, null]);
  });

  test("a held player his leagues never seated is a zero, not an absence", () => {
    const [a] = statRows(
      { a: lines.a },
      {},
      "ppr",
      { a: { started: 0, benched: 3, oppStarted: 0, oppBenched: 0 } },
    );
    assert.equal(a.held, true);
    assert.equal(a.start, 0);
    assert.equal(a.against, 0);
  });

  test("with no fold at all the board is the NFL's week and nothing else", () => {
    const rows = statRows(lines, {}, "ppr");
    assert.deepEqual(rows.map((r) => r.held), [false, false]);
  });

  test("`Yours` counts the rows anybody in those leagues holds", () => {
    assert.equal(heldStatRows(statRows(lines, {}, "ppr", shares)), 1);
    assert.equal(heldStatRows(statRows(lines, {}, "ppr")), 0);
  });
});

describe("narrowStatRows", () => {
  const rows = [
    row({ player_id: "a", name: "Ja'Marr Chase", position: "WR", team: "CIN" }),
    row({ player_id: "b", name: "Josh Allen", position: "QB", team: "BUF" }),
    row({ player_id: "c", name: "Bijan Robinson", position: "RB", team: "ATL" }),
  ];

  test("nothing asked leaves everything", () => {
    assert.equal(narrowStatRows(rows, NO_STAT_FILTERS).length, 3);
  });

  test("an empty set is `not asked` rather than `nothing chosen`", () => {
    // Read the other way, a value that appeared after the reader last touched
    // the menu would quietly drop off the list.
    assert.equal(
      narrowStatRows(rows, { ...NO_STAT_FILTERS, positions: [], teams: [] }).length,
      3,
    );
  });

  test("each menu is a multi-select, and its values are an OR", () => {
    const some = narrowStatRows(rows, { ...NO_STAT_FILTERS, positions: ["WR", "RB"] });
    assert.deepEqual(some.map((r) => r.player_id), ["a", "c"]);
  });

  test("the narrowings are one AND", () => {
    const none = narrowStatRows(rows, {
      ...NO_STAT_FILTERS,
      query: "chase",
      positions: ["QB"],
      teams: ["CIN"],
    });
    assert.equal(none.length, 0);
    const one = narrowStatRows(rows, {
      ...NO_STAT_FILTERS,
      query: "chase",
      positions: ["WR"],
      teams: ["CIN"],
    });
    assert.deepEqual(one.map((r) => r.player_id), ["a"]);
  });

  test("the search is a case-insensitive part of the name", () => {
    assert.equal(narrowStatRows(rows, { ...NO_STAT_FILTERS, query: "  ALLEN " }).length, 1);
  });

  test("a row with no name is narrowed away by a query and by nothing else", () => {
    const unnamed = [row({ name: null })];
    assert.equal(narrowStatRows(unnamed, { ...NO_STAT_FILTERS, query: "a" }).length, 0);
    assert.equal(narrowStatRows(unnamed, NO_STAT_FILTERS).length, 1);
  });

  test("a row with no team cannot match a team narrowing", () => {
    const teamless = [row({ team: null })];
    assert.equal(narrowStatRows(teamless, { ...NO_STAT_FILTERS, teams: ["CIN"] }).length, 0);
  });
});

describe("statFiltersActive", () => {
  test("blank space is not a narrowing", () => {
    assert.equal(statFiltersActive({ ...NO_STAT_FILTERS, query: "   " }), false);
    assert.equal(statFiltersActive(NO_STAT_FILTERS), false);
  });

  test("any one of the three is", () => {
    assert.equal(statFiltersActive({ ...NO_STAT_FILTERS, query: "a" }), true);
    assert.equal(statFiltersActive({ ...NO_STAT_FILTERS, positions: ["QB"] }), true);
    assert.equal(statFiltersActive({ ...NO_STAT_FILTERS, teams: ["CIN"] }), true);
  });
});

describe("toggleFilterValue", () => {
  test("adds what is not held and drops what is", () => {
    assert.deepEqual(toggleFilterValue(["QB"], "RB"), ["QB", "RB"]);
    assert.deepEqual(toggleFilterValue(["QB", "RB"], "QB"), ["RB"]);
  });

  test("order is the press order, which is what the trigger reads back", () => {
    assert.deepEqual(toggleFilterValue(toggleFilterValue([], "LAR"), "CIN"), ["LAR", "CIN"]);
  });
});

describe("menuSummary", () => {
  test("nothing picked is `All`, never an empty string", () => {
    assert.equal(menuSummary([], "positions"), "All");
  });

  test("one or two are named, and more are counted", () => {
    assert.equal(menuSummary(["QB"], "positions"), "QB");
    assert.equal(menuSummary(["CIN", "LAR"], "teams"), "CIN · LAR");
    assert.equal(menuSummary(["QB", "RB", "WR"], "positions"), "3 positions");
  });
});

describe("rankStatRows", () => {
  const rows = [
    mine({ player_id: "a", name: "Aaa", points: 12, start: 2, bench: 5, against: 1 }),
    mine({ player_id: "b", name: "Bbb", points: 24, start: 7, bench: 1, against: 3 }),
    mine({ player_id: "c", name: "Ccc", points: 18, start: 2, bench: 0, against: 9 }),
  ];
  const order = (key: StatSortKey, list: readonly StatRow[] = rows) =>
    rankStatRows(list, key).map((r) => r.player_id);

  test("points first is the default order", () => {
    assert.equal(DEFAULT_STAT_SORT, "points");
    assert.deepEqual(order("points"), ["b", "c", "a"]);
  });

  test("the rank is the row's place in this view, from one", () => {
    assert.deepEqual(rankStatRows(rows, "points").map((r) => r.rank), [1, 2, 3]);
  });

  test("it renumbers from one on a narrowing rather than carrying a stored place", () => {
    const narrowed = narrowStatRows(rows, { ...NO_STAT_FILTERS, query: "Ccc" });
    assert.deepEqual(rankStatRows(narrowed, "points").map((r) => r.rank), [1]);
  });

  test("every cap orders descending on its own count", () => {
    // `a` and `c` are level at two started, and points break it — see below.
    assert.deepEqual(order("start"), ["b", "c", "a"]);
    assert.deepEqual(order("bench"), ["a", "b", "c"]);
    assert.deepEqual(order("against"), ["c", "b", "a"]);
  });

  test("points break a tie on a count, and the name breaks that", () => {
    // Without the points tiebreak the two started twice would come back in
    // whatever order the ids arrived in — a list that reshuffles between
    // frames with nothing on screen having changed.
    assert.deepEqual(order("start").slice(1), ["c", "a"]);
    const level = [
      mine({ player_id: "x", name: "Zed", points: 9, start: 1, bench: 0, against: 0 }),
      mine({ player_id: "y", name: "Abe", points: 9, start: 1, bench: 0, against: 0 }),
    ];
    assert.deepEqual(order("start", level), ["y", "x"]);
  });

  test("an absent count sorts last, and a zero sorts as a zero", () => {
    // The distinction `StatRow.start` carries: a player nobody has is not the
    // least-started player of the week, he is not in the question at all.
    const mixed = [
      row({ player_id: "none", name: "Nn", points: 30 }),
      mine({ player_id: "zero", name: "Zz", points: 1, start: 0, bench: 0, against: 0 }),
      mine({ player_id: "some", name: "Ss", points: 2, start: 3, bench: 0, against: 0 }),
    ];
    assert.deepEqual(order("start", mixed), ["some", "zero", "none"]);
  });

  test("so pressing `Started` floats the reader's own players to the top", () => {
    const mixed = [
      row({ player_id: "nfl", name: "Nn", points: 99 }),
      mine({ player_id: "mine", name: "Mm", points: 1, start: 0, bench: 1, against: 0 }),
    ];
    assert.deepEqual(order("start", mixed), ["mine", "nfl"]);
  });

  test("the rows handed in are not reordered", () => {
    const held = [...rows];
    rankStatRows(held, "start");
    assert.deepEqual(held.map((r) => r.player_id), ["a", "b", "c"]);
  });
});

describe("statTeams", () => {
  test("distinct and sorted, and a row with no team offers none", () => {
    const rows = [
      row({ team: "LAR" }),
      row({ team: "CIN" }),
      row({ team: "LAR" }),
      row({ team: null }),
    ];
    assert.deepEqual(statTeams(rows), ["CIN", "LAR"]);
  });
});

describe("topStatRow", () => {
  test("the week's best, and null over nothing", () => {
    const rows = [row({ player_id: "a", points: 4 }), row({ player_id: "b", points: 31 })];
    assert.equal(topStatRow(rows)?.player_id, "b");
    assert.equal(topStatRow([]), null);
  });
});

describe("statTags", () => {
  test("only the counts he has a figure in", () => {
    assert.deepEqual(
      statTags(
        mine({ start: 7, bench: 0, oppStart: 3, oppBench: 0, against: 3 }),
      ).map((t) => `${t.label} ${t.count}`),
      ["Started 7", "Vs 3"],
    );
  });

  test("all four, where the four-column board could only sum the opposing two", () => {
    assert.deepEqual(
      statTags(
        mine({ start: 7, bench: 1, oppStart: 2, oppBench: 1, against: 3 }),
      ).map((t) => `${t.label} ${t.count}`),
      ["Started 7", "Sat 1", "Vs 2", "Opp sat 1"],
    );
  });

  test("a player nobody holds carries none", () => {
    assert.deepEqual(statTags(row()), []);
  });

  test("their keys are the four readings, in the vocabulary's own order", () => {
    const keys = statTags(
      mine({ start: 1, bench: 1, oppStart: 1, oppBench: 1, against: 2 }),
    ).map((t) => t.key);
    assert.deepEqual(keys, [...USAGE_KEYS]);
  });

  test("a held player who was never seated carries no tag either, and is not unheld", () => {
    // Which is why the cell reads `held` for its empty note rather than the
    // length of this list.
    const quiet = mine({ start: 0, bench: 0, oppStart: 0, oppBench: 0, against: 0 });
    assert.deepEqual(statTags(quiet), []);
    assert.equal(quiet.held, true);
  });
});

describe("statTagLine", () => {
  test("the same four, short, in the same order", () => {
    assert.equal(
      statTagLine(mine({ start: 6, bench: 2, oppStart: 4, oppBench: 1, against: 5 })),
      "6 st · 2 sat · 4 vs · 1 vs sat",
    );
  });

  test("a zero is omitted here too, and a row nobody holds is empty", () => {
    assert.equal(
      statTagLine(mine({ start: 0, bench: 2, oppStart: 0, oppBench: 0, against: 0 })),
      "2 sat",
    );
    assert.equal(statTagLine(row()), "");
  });
});

describe("the ledge's vocabularies", () => {
  test("the caps are the six sort keys, points first", () => {
    assert.deepEqual(
      STAT_SORTS.map((s) => s.key),
      ["points", "yds", "td", "start", "bench", "against"],
    );
    assert.equal(STAT_SORTS[0].key, DEFAULT_STAT_SORT);
  });

  test("every position the list filters by is one its rows can carry", () => {
    const positions: StatBoardPosition[] = ["QB", "RB", "WR", "TE"];
    assert.deepEqual([...STAT_POSITIONS], positions);
    for (const position of STAT_POSITIONS) {
      const rows = narrowStatRows([row({ position })], {
        ...NO_STAT_FILTERS,
        positions: [position],
      });
      assert.equal(rows.length, 1);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("the scoring terms are the column's own arithmetic", () => {
  test("every column has a rate, and every rate has a column", () => {
    // The tie rather than a shared order: a term inserted into one table must
    // not silently price the column after it in the other, which is what a
    // positional lookup between the two would do without failing anything.
    // One of each figure, so every term survives `statScoring`'s own drop.
    const all = line({
      pass_yd: 1, pass_td: 1, pass_int: 1,
      rush_yd: 1, rush_td: 1,
      rec: 1, rec_yd: 1, rec_td: 1,
      fumbles_lost: 1,
    });
    assert.equal(statScoring(all, "ppr").length, STAT_COLUMNS.length);
    // And the rate each column's own pane row states is that figure's, not
    // its neighbour's: a receiving yard is a tenth and a passing yard is not.
    const rows = statFamilies(all, "ppr");
    const rate = (family: string, label: string) =>
      rows.find((f) => f.key === family)?.rows.find((r) => r.label === label)?.rate;
    assert.equal(rate("pass", "Yards"), "0.04 each");
    assert.equal(rate("rush", "Yards"), "0.1 each");
    assert.equal(rate("rec", "Yards"), "0.1 each");
    assert.equal(rate("pass", "Touchdowns"), "4 each");
    assert.equal(rate("rec", "Touchdowns"), "6 each");
    assert.equal(rate("pass", "Interceptions"), "−2 each");
  });

  test("moving a passing yard from ÷25 to ×0.04 changes no printed figure", () => {
    // The two are not the same double — they differ by an ulp on 129 of the
    // first thousand integers — and this is the claim that matters: they are
    // the same *figure* once rounded, against every other term a line can
    // carry. Measured rather than asserted by assumption.
    for (let yd = 0; yd <= 1000; yd++) {
      for (const rest of [{}, { pass_td: 1 }, { rec: 7, rec_yd: 83 }, { fumbles_lost: 1 }]) {
        const stat = line({ pass_yd: yd, ...rest });
        const old =
          stat.pass_yd / 25 +
          stat.pass_td * 4 -
          stat.pass_int * 2 +
          stat.rush_yd / 10 +
          stat.rush_td * 6 +
          stat.rec * 1 +
          stat.rec_yd / 10 +
          stat.rec_td * 6 -
          stat.fumbles_lost * 2;
        assert.equal(statPoints(stat, "ppr"), Math.round(old * 10) / 10);
      }
    }
  });

  test("the rows of `how it adds up` sum to the figure they explain", () => {
    for (const basis of ["ppr", "half", "std"] as const) {
      const stat = line({
        pass_yd: 288, pass_td: 3, pass_int: 1,
        rush_yd: 42, rush_td: 1,
        rec: 8, rec_yd: 112, rec_td: 1,
        fumbles_lost: 1,
      });
      const summed = statScoring(stat, basis).reduce(
        // The pane sets a minus sign rather than a hyphen, which `Number`
        // does not read — so the test un-sets it, and would fail loudly if
        // the two ever stopped agreeing about which glyph a sign is.
        (total, row) => total + Number(row.value.replace("−", "-")),
        0,
      );
      assert.equal(Math.round(summed * 10) / 10, statPoints(stat, basis));
    }
  });

  test("a term nobody earned is dropped, and one worth nothing is not", () => {
    // A nought row says nothing; a reception on the standard basis is
    // `8 receptions × 0 = 0.0`, which is exactly the reader's question
    // answered — and dropping it would leave rows that do not add up.
    const rows = statScoring(line({ rec: 8, rec_yd: 40 }), "std");
    assert.deepEqual(
      rows.map((r) => `${r.label} ${r.rate} ${r.value}`),
      ["8 receptions × 0 0.0", "40 receiving yards × 0.1 4.0"],
    );
    assert.equal(rows[0].zero, true);
    assert.equal(rows[1].zero, false);
  });

  test("a minus is a minus sign, not a hyphen", () => {
    const rows = statScoring(line({ fumbles_lost: 2, pass_int: 1 }), "ppr");
    assert.ok(rows.every((r) => !r.rate.includes("-")));
    assert.ok(rows.some((r) => r.rate === "× −2"));
    // And the value beside it is the same glyph — one spelling of a sign.
    assert.ok(rows.every((r) => !r.value.includes("-")));
    assert.ok(rows.some((r) => r.value === "−4.0"));
  });

  test("one is singular", () => {
    const [one] = statScoring(line({ rec_td: 1 }), "ppr");
    assert.equal(one.label, "1 receiving touchdown");
    const [many] = statScoring(line({ rec_td: 2 }), "ppr");
    assert.equal(many.label, "2 receiving touchdowns");
  });
});

describe("statFamilies", () => {
  test("a family with nothing in it is absent, a nought inside a live one is kept", () => {
    const families = statFamilies(
      line({ rec: 8, rec_yd: 112, rec_td: 0, fumbles_lost: 1 }),
      "ppr",
    );
    assert.deepEqual(families.map((f) => f.key), ["rec", "fum"]);
    // The phone's own line omits the nought; the pane's rows keep it, because
    // there the rate beside it is the point.
    assert.equal(families[0].text, "8 rec · 112 yd");
    assert.deepEqual(families[0].rows.map((r) => r.value), ["8", "112", "0"]);
    assert.equal(families[0].rows[2].zero, true);
  });

  test("a line with nothing in it has no families at all", () => {
    assert.deepEqual(statFamilies(line(), "ppr"), []);
  });

  test("the rate each row states is the basis's own", () => {
    const ppr = statFamilies(line({ rec: 3 }), "ppr")[0].rows[0];
    const half = statFamilies(line({ rec: 3 }), "half")[0].rows[0];
    assert.equal(ppr.rate, "1 each");
    assert.equal(half.rate, "0.5 each");
  });
});

describe("the column table and the head derived from it", () => {
  test("every split carried, and the track that holds them", () => {
    assert.equal(statColumns([]).length, 9);
    assert.equal(statTrackWidth(statColumns([])), 1112);
  });

  test("a narrowed set keeps its own families and never the fumble", () => {
    const only = statColumns(["rec"]);
    assert.deepEqual(only.map((c) => c.key), ["rec", "rec_yd", "rec_td", "fumbles_lost"]);
  });

  test("each family's span is the sum of its own columns", () => {
    // The mismatch this exists to prevent is silent: a span a column short
    // files every figure after it under the wrong family.
    for (const splits of [[], ["pass"], ["rush", "rec"], ["pass", "rush", "rec"]] as const) {
      const columns = statColumns([...splits]);
      const spans = statGroupSpans(columns);
      for (const span of spans) {
        if (span.key === "player" || span.key === "game") continue;
        if (span.key === "leagues" || span.key === "points") continue;
        const width = columns
          .filter((c) => c.family === span.key)
          .reduce((total, c) => total + c.width, 0);
        assert.equal(span.width, width, `${span.key} under ${splits.join("+") || "all"}`);
      }
      // And the whole tier is the row's own track, to the pixel.
      assert.equal(
        spans.reduce((total, s) => total + s.width, 0),
        statTrackWidth(columns),
      );
    }
  });

  test("the head pins the same two widths the rows do", () => {
    const spans = statGroupSpans(statColumns([]));
    const left = spans.find((s) => s.pin === "left");
    const right = spans.find((s) => s.pin === "right");
    assert.equal(left?.width, STAT_FIXED.player);
    assert.equal(right?.width, STAT_FIXED.points);
    // Exactly one of each — two pinned left blocks would stack at the edge.
    assert.equal(spans.filter((s) => s.pin === "left").length, 1);
    assert.equal(spans.filter((s) => s.pin === "right").length, 1);
  });

  test("the first span is uncut and every boundary after it is not", () => {
    const spans = statGroupSpans(statColumns([]));
    assert.equal(spans[0].cut, false);
    assert.deepEqual(
      spans.map((s) => s.key),
      ["player", "game", "pass", "rush", "rec", "fum", "leagues", "points"],
    );
  });
});

describe("the usage narrowing", () => {
  const held = (over: Partial<StatRow>) =>
    row({ held: true, start: 0, bench: 0, oppStart: 0, oppBench: 0, against: 0, ...over });

  test("every picked reading, somewhere — the caps are an AND", () => {
    const rows = [
      held({ player_id: "both", start: 2, oppBench: 1 }),
      held({ player_id: "one", start: 3 }),
      row({ player_id: "none" }),
    ];
    assert.deepEqual(
      narrowStatRows(rows, { ...NO_STAT_FILTERS, usage: ["start"] }).map((r) => r.player_id),
      ["both", "one"],
    );
    assert.deepEqual(
      narrowStatRows(rows, { ...NO_STAT_FILTERS, usage: ["start", "opp-bench"] }).map(
        (r) => r.player_id,
      ),
      ["both"],
    );
  });

  test("a null count fails every reading and a nought fails its own", () => {
    const unheld = row({ player_id: "u" });
    const never = held({ player_id: "h", bench: 0 });
    for (const key of USAGE_KEYS) {
      assert.deepEqual(
        narrowStatRows([unheld, never], { ...NO_STAT_FILTERS, usage: [key] }),
        [],
      );
    }
  });

  test("an empty set is not asked rather than nothing chosen", () => {
    const rows = [row({ player_id: "a" }), held({ player_id: "b", start: 1 })];
    assert.equal(narrowStatRows(rows, NO_STAT_FILTERS).length, 2);
    assert.equal(statFiltersActive({ ...NO_STAT_FILTERS, usage: ["start"] }), true);
    assert.equal(statFiltersActive(NO_STAT_FILTERS), false);
  });
});

describe("usageLeagueScope", () => {
  const rows = [
    row({ player_id: "a", held: true }),
    row({ player_id: "b", held: true }),
  ];
  const leagues = {
    a: { start: ["L1", "L2"], bench: [], "opp-start": [], "opp-bench": ["L2"] },
    b: { start: ["L3"], bench: ["L1"], "opp-start": [], "opp-bench": ["L1"] },
  } as const;

  test("nothing pressed is not narrowing, which is not an empty set", () => {
    assert.equal(usageLeagueScope(rows, [], leagues), null);
  });

  test("one reading is the union across the population", () => {
    assert.deepEqual(
      [...usageLeagueScope(rows, ["start"], leagues)!].sort(),
      ["L1", "L2", "L3"],
    );
  });

  test("two readings are an AND at the league, an OR across players", () => {
    // L1: `b` was benched there and `b` was opp-benched there. L2: `a` was
    // started and opp-benched there. So `start` ∧ `opp-bench` leaves both —
    // and it is two different players answering in L1, which is the whole
    // reason this conjunction has anything to say.
    assert.deepEqual(
      [...usageLeagueScope(rows, ["start", "opp-bench"], leagues)!].sort(),
      ["L1", "L2"],
    );
    assert.deepEqual(
      [...usageLeagueScope(rows, ["start", "bench"], leagues)!].sort(),
      ["L1"],
    );
  });

  test("a narrowing that leaves nothing is an empty set, not null", () => {
    const none = usageLeagueScope(rows, ["opp-start"], leagues);
    assert.notEqual(none, null);
    assert.equal(none!.size, 0);
  });

  test("it is asked over the rows it is handed — the board's own narrowing", () => {
    // The scope a reader gets when they have already narrowed to one player is
    // that player's leagues, which is the whole argument for the caps living
    // on the board's ledge rather than in the page header.
    assert.deepEqual(
      [...usageLeagueScope([rows[0]], ["start"], leagues)!].sort(),
      ["L1", "L2"],
    );
  });
});

describe("playerLeagueScope", () => {
  const leagues = {
    start: ["L1", "L2"],
    bench: [],
    "opp-start": ["L3"],
    "opp-bench": [],
  } as const;

  test("one reading, and nothing picked is not narrowing", () => {
    assert.deepEqual([...playerLeagueScope("start", leagues)!].sort(), ["L1", "L2"]);
    assert.equal(playerLeagueScope(null, leagues), null);
    assert.equal(playerLeagueScope("start", null), null);
  });

  test("a reading he has none of is an empty set", () => {
    assert.equal(playerLeagueScope("bench", leagues)!.size, 0);
  });

  test("all is every league he is in, either side", () => {
    assert.deepEqual([...playerLeagueScope("all", leagues)!].sort(), ["L1", "L2", "L3"]);
    assert.equal(playerLeagueScope("all", null), null);
  });
});

describe("readingCount", () => {
  test("a reading is its own count, and all is the four summed", () => {
    const r = row({ held: true, start: 2, bench: 1, oppStart: 3, oppBench: 0 });
    assert.equal(readingCount(r, "start"), 2);
    assert.equal(readingCount(r, "opp-start"), 3);
    assert.equal(readingCount(r, "all"), 6);
  });

  test("a player nobody holds counts nothing rather than nought", () => {
    assert.equal(readingCount(row({ held: false }), "all"), null);
  });

  test("the track reads All first, then the four", () => {
    assert.deepEqual(PLAYER_READINGS, ["all", ...USAGE_KEYS]);
    assert.equal(READING_LABEL.all, "All");
  });
});

describe("the two summed sorts", () => {
  const stat = (over: Partial<StatRow>) => row(over);

  test("yards are the three families summed, and so are touchdowns", () => {
    const r = stat({ pass_yd: 100, rush_yd: 20, rec_yd: 5, pass_td: 1, rush_td: 2, rec_td: 3 });
    assert.equal(statYards(r), 125);
    assert.equal(statTouchdowns(r), 6);
  });

  test("descending, with points as the tiebreaker", () => {
    const rows = [
      stat({ player_id: "few", rush_yd: 10, points: 9 }),
      stat({ player_id: "many", rec_yd: 100, points: 1 }),
      stat({ player_id: "tie", rush_yd: 10, points: 2 }),
    ];
    assert.deepEqual(
      rankStatRows(rows, "yds").map((r) => r.player_id),
      ["many", "few", "tie"],
    );
  });

  test("the rank renumbers from 1 on every view", () => {
    const rows = [stat({ player_id: "a", rec_td: 2 }), stat({ player_id: "b", rec_td: 1 })];
    assert.deepEqual(rankStatRows(rows, "td").map((r) => r.rank), [1, 2]);
    assert.deepEqual(rankStatRows([rows[1]], "td").map((r) => r.rank), [1]);
  });
});

describe("the usage vocabulary is one spelling", () => {
  test("the four readings, the four labels and the four counts agree", () => {
    assert.deepEqual([...USAGE_KEYS], ["start", "bench", "opp-start", "opp-bench"]);
    for (const key of USAGE_KEYS) {
      assert.equal(typeof USAGE_LABEL[key], "string");
      assert.ok(USAGE_LABEL[key].length > 0);
      assert.equal(typeof USAGE_CHIP[key], "string");
      assert.equal(typeof USAGE_COUNT[key], "function");
    }
  });

  test("the summary names what was pressed, in the order it was pressed", () => {
    assert.equal(usageSummary(["start", "opp-bench"]), "Started · They sat");
    assert.equal(usageSummary([]), "");
  });
});
