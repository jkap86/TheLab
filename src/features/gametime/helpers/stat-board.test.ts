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
  STAT_SORTS,
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
    against: null,
    ...over,
  };
}

/** A row the fold answered for — held, with the three counts as given. */
function mine(
  over: Partial<StatRow> & { start: number; bench: number; against: number },
): StatRow {
  return row({ held: true, ...over });
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

  test("the three narrowings are one AND", () => {
    const none = narrowStatRows(rows, {
      query: "chase",
      positions: ["QB"],
      teams: ["CIN"],
    });
    assert.equal(none.length, 0);
    const one = narrowStatRows(rows, {
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
      statTags(mine({ start: 7, bench: 0, against: 3 })).map((t) => `${t.label} ${t.count}`),
      ["Started 7", "Against 3"],
    );
  });

  test("a player nobody holds carries none", () => {
    assert.deepEqual(statTags(row()), []);
  });

  test("their keys are the sort keys, so a lit cap names a tag", () => {
    const keys = statTags(mine({ start: 1, bench: 1, against: 1 })).map((t) => t.key);
    assert.deepEqual(keys, ["start", "bench", "against"]);
    for (const key of keys) {
      assert.ok(STAT_SORTS.some((sort) => sort.key === key));
    }
  });

  test("a held player who was never seated carries no tag either, and is not unheld", () => {
    // Which is why the cell reads `held` for its empty note rather than the
    // length of this list.
    const quiet = mine({ start: 0, bench: 0, against: 0 });
    assert.deepEqual(statTags(quiet), []);
    assert.equal(quiet.held, true);
  });
});

describe("statTagLine", () => {
  test("the same three, short, in the same order", () => {
    assert.equal(statTagLine(mine({ start: 6, bench: 2, against: 4 })), "6 st · 2 sat · 4 vs");
  });

  test("a zero is omitted here too, and a row nobody holds is empty", () => {
    assert.equal(statTagLine(mine({ start: 0, bench: 2, against: 0 })), "2 sat");
    assert.equal(statTagLine(row()), "");
  });
});

describe("the ledge's vocabularies", () => {
  test("the caps are the four sort keys, points first", () => {
    assert.deepEqual(
      STAT_SORTS.map((s) => s.key),
      ["points", "start", "bench", "against"],
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
