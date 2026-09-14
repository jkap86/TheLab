import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  defaultStatAscending,
  heldStatRows,
  narrowStatRows,
  nextStatSort,
  parseStatBasis,
  rankStatRows,
  statFacetCount,
  statFacetCounts,
  statFilterSummary,
  statFiltersActive,
  statPoints,
  statRows,
  statTagLine,
  statTags,
  toggleFacet,
  topStatRow,
  ALL_SPLITS,
  DEFAULT_STAT_SORT,
  DEFAULT_STAT_SORT_STATE,
  NO_STAT_FILTERS,
  STAT_POSITIONS,
  STAT_COLUMNS,
  STAT_FIXED,
  STAT_STAGE_BOUNDS,
  STAT_STAGES,
  STAT_USAGE_WIDTH,
  statColumns,
  statFamilies,
  statGroupSpans,
  statHeads,
  statScoring,
  statSortFor,
  statTrackWidth,
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
import type { StatRow, StatSort, StatSortKey } from "./stat-board.ts";
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
    pass_cmp: 0,
    pass_att: 0,
    pass_yd: 0,
    pass_td: 0,
    pass_int: 0,
    rush_att: 0,
    rush_yd: 0,
    rush_td: 0,
    targets: 0,
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
    stage: 5,
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
    // 10 + 8 − 1 + 3 + 6. The interception is `−1` where this read `−2` until
    // the redesign moved it — see `scoringTerms`, which states why.
    assert.equal(statPoints(stat, "ppr"), 26);
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

describe("toggleFacet", () => {
  test("adds what is not held and drops what is", () => {
    assert.deepEqual(toggleFacet(["QB"], "RB"), ["QB", "RB"]);
    assert.deepEqual(toggleFacet(["QB", "RB"], "QB"), ["RB"]);
  });

  test("order is the press order, which is what the foot reads back", () => {
    assert.deepEqual(toggleFacet(toggleFacet([], "LAR"), "CIN"), ["LAR", "CIN"]);
  });
});

describe("rankStatRows", () => {
  const rows = [
    mine({ player_id: "a", name: "Aaa", points: 12, start: 2, bench: 5, against: 1 }),
    mine({ player_id: "b", name: "Bbb", points: 24, start: 7, bench: 1, against: 3 }),
    mine({ player_id: "c", name: "Ccc", points: 18, start: 2, bench: 0, against: 9 }),
  ];
  const sorted = (key: StatSortKey, asc = false) => ({ key, asc }) as StatSort;
  const order = (key: StatSortKey, list: readonly StatRow[] = rows, asc = false) =>
    rankStatRows(list, sorted(key, asc)).map((r) => r.player_id);

  test("points first is the default order, descending", () => {
    assert.equal(DEFAULT_STAT_SORT, "points");
    assert.deepEqual(DEFAULT_STAT_SORT_STATE, { key: "points", asc: false });
    assert.deepEqual(order("points"), ["b", "c", "a"]);
  });

  test("the rank is the row's place in this view, from one", () => {
    assert.deepEqual(rankStatRows(rows, sorted("points")).map((r) => r.rank), [1, 2, 3]);
  });

  test("it renumbers from one on a narrowing rather than carrying a stored place", () => {
    const narrowed = narrowStatRows(rows, { ...NO_STAT_FILTERS, query: "Ccc" });
    assert.deepEqual(rankStatRows(narrowed, sorted("points")).map((r) => r.rank), [1]);
  });

  test("every head orders descending on its own count", () => {
    // `a` and `c` are level at two started, and points break it — see below.
    assert.deepEqual(order("start"), ["b", "c", "a"]);
    assert.deepEqual(order("bench"), ["a", "b", "c"]);
    assert.deepEqual(order("opp-start"), ["c", "b", "a"]);
  });

  test("a press on the lit head reverses it", () => {
    assert.deepEqual(order("points", rows, true), ["a", "c", "b"]);
    // **The tiebreak does not reverse with it**, which is the half of a
    // reversible sort that is silent: `a` and `c` are level at two started,
    // and points settle them the same way in both directions. Flipped, the
    // list would reshuffle its own ties on every press.
    assert.deepEqual(order("start", rows, true), ["c", "a", "b"]);
  });

  test("the name is the one head that opens ascending", () => {
    assert.equal(defaultStatAscending("name"), true);
    for (const key of ["points", "clock", "start", "rec_yd"] as const) {
      assert.equal(defaultStatAscending(key), false);
    }
    assert.deepEqual(order("name", rows, true), ["a", "b", "c"]);
    assert.deepEqual(order("name", rows, false), ["c", "b", "a"]);
  });

  test("a fresh press takes the key's own direction; the lit one flips", () => {
    // The two arms are not symmetrical, which is the whole reason this is a
    // function rather than a ternary at the call site.
    const points = DEFAULT_STAT_SORT_STATE;
    assert.deepEqual(nextStatSort(points, "name"), { key: "name", asc: true });
    assert.deepEqual(nextStatSort(points, "points"), { key: "points", asc: true });
    assert.deepEqual(nextStatSort({ key: "name", asc: true }, "name"), {
      key: "name",
      asc: false,
    });
  });

  test("a sort the columns can still answer is kept, by identity", () => {
    // Returned by identity so the splits handler may hand it straight back to
    // `setState` and re-render nothing on the ordinary press.
    const held: StatSort = { key: "pass_yd", asc: false };
    assert.equal(statSortFor(held, statColumns(ALL_SPLITS)), held);
    assert.equal(statSortFor(held, statColumns(["pass"])), held);
  });

  test("a sort whose column the splits rail dropped falls back to points", () => {
    // The one thing the head-as-sort model can get wrong that the six-cap
    // rail it replaced could not: a list ordered by a column nothing on
    // screen names, no head lit, and no way back to that order.
    assert.deepEqual(statSortFor({ key: "pass_yd", asc: true }, statColumns(["rush", "rec"])), {
      key: "points",
      asc: false,
    });
    assert.deepEqual(statSortFor({ key: "rec_td", asc: false }, statColumns(["pass"])), {
      key: "points",
      asc: false,
    });
  });

  test("the four keys no rail can remove are never fallen back from", () => {
    // Name, clock, the four usage readings and points are heads of their own
    // rather than columns, so every set of splits still answers them.
    for (const key of ["name", "clock", "start", "opp-bench", "points"] as const) {
      const held: StatSort = { key, asc: true };
      assert.equal(statSortFor(held, statColumns(["rec"])), held);
    }
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
    // **And still last with the arrow flipped**, which is the half only a
    // reversible sort can get wrong: folded into the comparison, ascending
    // would float every row the question is not about to the top.
    assert.deepEqual(order("start", mixed, true), ["zero", "some", "none"]);
  });

  test("a row whose game the board could not read sorts last on the clock", () => {
    const mixed = [
      row({ player_id: "bye", name: "Bb", stage: null, points: 40 }),
      row({ player_id: "pre", name: "Pp", stage: 0, points: 1 }),
      row({ player_id: "done", name: "Dd", stage: 5, points: 2 }),
    ];
    assert.deepEqual(order("clock", mixed), ["done", "pre", "bye"]);
    assert.deepEqual(order("clock", mixed, true), ["pre", "done", "bye"]);
  });

  test("a split column orders on its own figure", () => {
    const mixed = [
      row({ player_id: "a", name: "Aa", rec_yd: 40, targets: 9 }),
      row({ player_id: "b", name: "Bb", rec_yd: 112, targets: 3 }),
    ];
    assert.deepEqual(order("rec_yd", mixed), ["b", "a"]);
    assert.deepEqual(order("targets", mixed), ["a", "b"]);
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
    rankStatRows(held, sorted("start"));
    assert.deepEqual(held.map((r) => r.player_id), ["a", "b", "c"]);
  });
});

describe("statFacetCounts", () => {
  test("how many rows each value would leave, over the unfiltered population", () => {
    const rows = [
      row({ team: "LAR", position: "WR" }),
      row({ team: "CIN", position: "QB" }),
      row({ team: "LAR", position: "WR" }),
      row({ team: null, position: "TE" }),
    ];
    assert.deepEqual([...statFacetCounts(rows, (r) => r.team)], [["LAR", 2], ["CIN", 1]]);
    assert.deepEqual(
      [...statFacetCounts(rows, (r) => r.position)],
      [["WR", 2], ["QB", 1], ["TE", 1]],
    );
  });

  test("a row with no answer is in no bucket rather than in one of its own", () => {
    // The Team menu simply does not offer a code for a row the feed named no
    // team for, where an `Unknown` chip would be a value nothing else on the
    // board prints.
    const counts = statFacetCounts([row({ team: null })], (r) => r.team);
    assert.equal(counts.size, 0);
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
    // Nine of the thirteen columns are priced; the four volume figures are
    // not — a completion is not worth nothing, it is not worth anything.
    assert.equal(statScoring(all, "ppr").length, STAT_COLUMNS.length - 4);
    // And the rate each figure's own pane row states is that figure's, not its
    // neighbour's: a receiving yard is a tenth and a passing yard is not.
    const rate = (label: string) =>
      statScoring(all, "ppr").find((r) => r.label.endsWith(label))?.rate;
    assert.equal(rate("passing yard"), "0.04 / yd");
    assert.equal(rate("rushing yard"), "0.1 / yd");
    assert.equal(rate("receiving yard"), "0.1 / yd");
    assert.equal(rate("passing touchdown"), "4.0 each");
    assert.equal(rate("receiving touchdown"), "6.0 each");
    assert.equal(rate("interception"), "−1.0 each");
  });

  test("the volume figures carry no term at all and are priced at nothing", () => {
    // The distinction that decides how the pane draws a family: absent from
    // the table rather than present at zero, so `statPoints` cannot price one
    // by accident and a family row cannot print `0 each` beside a completion.
    const volume = line({ pass_cmp: 24, pass_att: 35, rush_att: 9, targets: 11 });
    assert.equal(statPoints(volume, "ppr"), 0);
    assert.deepEqual(statScoring(volume, "ppr"), []);
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
          stat.pass_int * 1 +
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
      ["8 receptions 0.0 each 0.0", "40 receiving yards 0.1 / yd 4.0"],
    );
    assert.equal(rows[0].zero, true);
    assert.equal(rows[1].zero, false);
  });

  test("a minus is a minus sign, not a hyphen", () => {
    const rows = statScoring(line({ fumbles_lost: 2, pass_int: 1 }), "ppr");
    assert.ok(rows.every((r) => !(r.rate ?? "").includes("-")));
    assert.ok(rows.some((r) => r.rate === "−2.0 each"));
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
      line({ targets: 11, rec: 8, rec_yd: 112, rec_td: 0, fumbles_lost: 1 }),
    );
    assert.deepEqual(families.map((f) => f.key), ["rec", "fum"]);
    // The phone's own line omits the nought; the pane's rows keep it, because
    // there the count beside its neighbours is the point.
    assert.equal(families[0].text, "11 tgt · 8 rec · 112 yd");
    assert.deepEqual(families[0].rows.map((r) => r.value), ["11", "8", "112", "0"]);
    assert.equal(families[0].rows[3].zero, true);
  });

  test("a line with nothing in it has no families at all", () => {
    assert.deepEqual(statFamilies(line()), []);
  });

  test("a family row carries no rate, and the sum group carries them all", () => {
    // The two groups answer two questions — a family says what he did and
    // `How 25.2 adds up` says what it was worth — so a rate printed on both
    // would be the second explaining a figure the first had already priced.
    // With the volume columns it is more than untidy: a completion has no
    // price, and `0 each` beside one is a claim.
    const stat = line({ pass_cmp: 24, pass_att: 35, pass_yd: 288, pass_td: 3 });
    assert.ok(statFamilies(stat).every((f) => f.rows.every((r) => r.rate === null)));
    assert.ok(statScoring(stat, "ppr").every((r) => r.rate !== null));
  });

  test("volume leads the family it belongs to, on the strip and in the pane", () => {
    const passer = statFamilies(line({ pass_cmp: 24, pass_att: 35, pass_yd: 288 }))[0];
    assert.equal(passer.text, "24 cmp · 35 att · 288 yd");
    assert.deepEqual(
      passer.rows.map((r) => r.label),
      ["Completions", "Attempts", "Yards", "Touchdowns", "Interceptions"],
    );
    const runner = statFamilies(line({ rush_att: 18, rush_yd: 96 }))[0];
    assert.equal(runner.text, "18 car · 96 yd");
  });
});

describe("the column table and the head derived from it", () => {
  test("every split carried, and the track that holds them", () => {
    assert.equal(statColumns([]).length, 13);
    // 258 + 100 + 600 of splits + 4 × 72 of counts + 84.
    assert.equal(statTrackWidth(statColumns([])), 1330);
    assert.equal(STAT_USAGE_WIDTH, STAT_FIXED.count * USAGE_KEYS.length);
  });

  test("volume leads each family in the column order too", () => {
    // What a reader travelling left to right meets is the denominator before
    // the numerator: the yardage is *earned from* the attempts in front of it.
    assert.deepEqual(
      statColumns([]).map((c) => c.key),
      [
        "pass_cmp", "pass_att", "pass_yd", "pass_td", "pass_int",
        "rush_att", "rush_yd", "rush_td",
        "targets", "rec", "rec_yd", "rec_td",
        "fumbles_lost",
      ],
    );
  });

  test("every head is a column, a fixed track or a usage reading — and no more", () => {
    // Derived from the same table the row and the spans are, so a column
    // added, dropped or resized moves its own head with it. A hand-kept list
    // is one that files `Rushing TD` over a passing touchdown the first time a
    // column moves, with every number on the board correct.
    const columns = statColumns([]);
    const heads = statHeads(columns);
    assert.deepEqual(
      heads.map((h) => h.key),
      ["name", "clock", ...columns.map((c) => c.key), ...USAGE_KEYS, "points"],
    );
    // And the heads are exactly as wide as the cells beneath them.
    assert.equal(
      heads.reduce((total, h) => total + h.width, 0),
      statTrackWidth(columns),
    );
    for (const splits of [["pass"], ["rush", "rec"]] as const) {
      const narrowed = statColumns([...splits]);
      assert.equal(
        statHeads(narrowed).reduce((total, h) => total + h.width, 0),
        statTrackWidth(narrowed),
      );
    }
  });

  test("the two pinned heads are the two pinned cells, and nothing else pins", () => {
    const heads = statHeads(statColumns([]));
    assert.equal(heads.filter((h) => h.pin === "left").length, 1);
    assert.equal(heads.filter((h) => h.pin === "right").length, 1);
    assert.equal(heads.find((h) => h.pin === "left")?.width, STAT_FIXED.player);
    assert.equal(heads.find((h) => h.pin === "right")?.width, STAT_FIXED.points);
    // The name reads left and every figure reads right, under its own column.
    assert.equal(heads[0].align, "left");
    assert.ok(heads.slice(1).every((h) => h.align === "right"));
  });

  test("every head names itself in full for a press that cannot show a word", () => {
    // `Yd` is three heads under three families, and `Tgt` is three letters:
    // the hint is what a screen reader hears instead of either.
    const hints = new Map(statHeads(statColumns([])).map((h) => [h.key, h.hint]));
    assert.equal(hints.get("pass_yd"), "Passing yards");
    assert.equal(hints.get("rec_yd"), "Receiving yards");
    assert.equal(hints.get("targets"), "Targets");
    assert.equal(hints.get("start"), USAGE_LABEL.start);
    assert.ok([...hints.values()].every((hint) => hint.length > 0));
  });

  test("a narrowed set keeps its own families and never the fumble", () => {
    const only = statColumns(["rec"]);
    assert.deepEqual(
      only.map((c) => c.key),
      ["targets", "rec", "rec_yd", "rec_td", "fumbles_lost"],
    );
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
        spans.reduce((total, span) => total + span.width, 0),
        statTrackWidth(columns),
      );
    }
  });

  test("the head pins the same two widths the rows do", () => {
    const spans = statGroupSpans(statColumns([]));
    const left = spans.find((span) => span.pin === "left");
    const right = spans.find((span) => span.pin === "right");
    assert.equal(left?.width, STAT_FIXED.player);
    assert.equal(right?.width, STAT_FIXED.points);
    // Exactly one of each — two pinned left blocks would stack at the edge.
    assert.equal(spans.filter((span) => span.pin === "left").length, 1);
    assert.equal(spans.filter((span) => span.pin === "right").length, 1);
  });

  test("the four usage columns sit under one word, which the lower tier cannot say", () => {
    const leagues = statGroupSpans(statColumns([])).find((span) => span.key === "leagues");
    assert.equal(leagues?.label, "Your leagues");
    assert.equal(leagues?.width, STAT_USAGE_WIDTH);
    // And it is the only span in the upper tier that labels anything the
    // lower one does not already say.
    assert.deepEqual(
      statGroupSpans(statColumns([]))
        .filter((span) => span.label !== "")
        .map((span) => span.label),
      ["Passing", "Rushing", "Receiving", "Your leagues"],
    );
  });

  test("the first span is uncut and every boundary after it is not", () => {
    const spans = statGroupSpans(statColumns([]));
    assert.equal(spans[0].cut, false);
    assert.deepEqual(
      spans.map((span) => span.key),
      ["player", "game", "pass", "rush", "rec", "fum", "leagues", "points"],
    );
  });
});

describe("the clock facet", () => {
  const at = (over: Partial<import("@/shared/contract").GametimeGame>) =>
    statRows(
      { "1": line({ team: "CIN" }) },
      { CIN: game(over) },
      "ppr",
    )[0].stage;

  test("six stops, and `Pre` is the one the design's five could not hold", () => {
    // A five-stop scale has nowhere to put a game that has not kicked off but
    // `F`, which is a filter that lies about a four o'clock kickoff.
    assert.deepEqual([...STAT_STAGES], ["Pre", "Q1", "Q2", "Q3", "Q4", "F"]);
    assert.deepEqual(STAT_STAGE_BOUNDS, { lo: 0, hi: 5 });
  });

  test("a stop is read off the game, never parsed back out of the clock's label", () => {
    assert.equal(at({ phase: "pre", kickoff: 1 }), 0);
    assert.equal(at({ phase: "live", quarter: 1, clock: "12:00" }), 1);
    assert.equal(at({ phase: "live", quarter: 3, clock: "04:11" }), 3);
    assert.equal(at({ phase: "final" }), 5);
  });

  test("overtime is the last running stop, not the finished one", () => {
    // It is past the fourth quarter and it is not over, and the distinction
    // the facet is asked about is running against finished.
    assert.equal(at({ phase: "live", overtime: true, quarter: 5, clock: "07:20" }), 4);
  });

  test("a bye and a live game with no quarter are both unknown, not a guess", () => {
    assert.equal(statRows({ "1": line({ team: "CIN" }) }, {}, "ppr")[0].stage, null);
    assert.equal(at({ phase: "live", quarter: null, clock: null }), null);
  });

  test("an untouched span narrows nothing, including the rows with no stop", () => {
    const rows = [row({ player_id: "bye", stage: null }), row({ player_id: "q1", stage: 1 })];
    assert.equal(narrowStatRows(rows, NO_STAT_FILTERS).length, 2);
    assert.equal(
      narrowStatRows(rows, { ...NO_STAT_FILTERS, clock: { lo: 0, hi: 5 } }).length,
      2,
    );
  });

  test("a narrowing span takes its own stops, and an unknown stop is outside it", () => {
    const rows = [
      row({ player_id: "bye", stage: null }),
      row({ player_id: "pre", stage: 0 }),
      row({ player_id: "q3", stage: 3 }),
      row({ player_id: "done", stage: 5 }),
    ];
    assert.deepEqual(
      narrowStatRows(rows, { ...NO_STAT_FILTERS, clock: { lo: 1, hi: 4 } }).map(
        (r) => r.player_id,
      ),
      ["q3"],
    );
    assert.deepEqual(
      narrowStatRows(rows, { ...NO_STAT_FILTERS, clock: { lo: 0, hi: 0 } }).map(
        (r) => r.player_id,
      ),
      ["pre"],
    );
  });
});

describe("the Filters key's badge and the tray's foot", () => {
  test("facets are counted, never values", () => {
    // "3" beside the key means three questions are answered, which is what a
    // reader can act on; the chips inside them are the tray's own business.
    assert.equal(statFacetCount(NO_STAT_FILTERS), 0);
    assert.equal(
      statFacetCount({ ...NO_STAT_FILTERS, positions: ["QB", "RB", "WR"] }),
      1,
    );
    assert.equal(
      statFacetCount({
        ...NO_STAT_FILTERS,
        positions: ["QB"],
        teams: ["CIN"],
        clock: { lo: 1, hi: 4 },
        usage: ["start"],
      }),
      4,
    );
  });

  test("the search is not one of them, and a full-width span is not either", () => {
    // The field is on the ledge with its own text in it, so a badge counting
    // it would be the same narrowing stated twice on one row; and a span on
    // both bounds is the reader not having asked.
    assert.equal(statFacetCount({ ...NO_STAT_FILTERS, query: "chase" }), 0);
    assert.equal(statFacetCount({ ...NO_STAT_FILTERS, clock: { lo: 0, hi: 5 } }), 0);
    // It is still a narrowing, which is what lights the ledge's own count.
    assert.equal(statFiltersActive({ ...NO_STAT_FILTERS, query: "chase" }), true);
    assert.equal(statFiltersActive({ ...NO_STAT_FILTERS, clock: { lo: 0, hi: 5 } }), false);
  });

  test("every facet the badge counts is named in the foot", () => {
    // A foot reading `Nothing narrowed` under a badge reading `1` is a
    // contradiction on one row of one tray.
    assert.equal(statFilterSummary(NO_STAT_FILTERS), null);
    assert.equal(
      statFilterSummary({
        ...NO_STAT_FILTERS,
        positions: ["QB"],
        teams: ["CIN", "LAR"],
        clock: { lo: 1, hi: 3 },
        usage: ["start", "opp-bench"],
      }),
      "Pos QB · Team CIN · LAR · Clock Q1–Q3 · Started · They sat",
    );
  });

  test("the foot names the stops rather than their indices", () => {
    assert.equal(
      statFilterSummary({ ...NO_STAT_FILTERS, clock: { lo: 0, hi: 4 } }),
      "Clock Pre–Q4",
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
