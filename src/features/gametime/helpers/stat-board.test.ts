import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  narrowStatRows,
  rankStatRows,
  statFiltersActive,
  statGroupSpans,
  statLineSummary,
  statPoints,
  statRows,
  statTeams,
  STAT_COLUMNS,
  STAT_GRID_TEMPLATE,
  PHONE_SORTS,
  parseStatBasis,
  sortLabel,
  topStatRow,
} from "./stat-board.ts";
import type { StatRow } from "./stat-board.ts";
import type { GametimeGame, GametimeStatLine, StatBoardPosition } from "@/shared/contract";

/**
 * The stat board's arithmetic.
 *
 * Every rule here draws a perfectly ordinary table when it is wrong — a
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
    ...over,
  };
}

describe("statPoints", () => {
  test("prices a passing line the standard way", () => {
    // 287/25 + 3*4 - 1*2 + 44/10 + 1*6 = 11.48 + 12 - 2 + 4.4 + 6
    const allen = line({ pass_yd: 287, pass_td: 3, pass_int: 1, rush_yd: 44, rush_td: 1 });
    assert.equal(statPoints(allen, "ppr"), 31.9);
  });

  test("the basis is the reception and nothing else", () => {
    const chase = line({ rec: 11, rec_yd: 148, rec_td: 2 });
    assert.equal(statPoints(chase, "ppr"), 37.8);
    assert.equal(statPoints(chase, "half"), 32.3);
    assert.equal(statPoints(chase, "std"), 26.8);
  });

  test("a lost fumble is minus two, and a week can be negative", () => {
    assert.equal(statPoints(line({ fumbles_lost: 1 }), "ppr"), -2);
  });

  test("rounds to the one decimal the column prints", () => {
    // 7/25 = 0.28
    assert.equal(statPoints(line({ pass_yd: 7 }), "std"), 0.3);
  });
});

describe("parseStatBasis", () => {
  test("an unreadable basis is PPR, never a third scale", () => {
    assert.equal(parseStatBasis("nonsense"), "ppr");
    assert.equal(parseStatBasis(undefined), "ppr");
    assert.equal(parseStatBasis("half"), "half");
    assert.equal(parseStatBasis("std"), "std");
  });
});

describe("statRows", () => {
  const board: Record<string, GametimeGame> = {
    CIN: game({ opponent: "PIT", home: false }),
    BAL: game({ opponent: "CLE", home: true, phase: "live", quarter: 3, clock: "08:04" }),
  };

  test("an away game prints its opponent with an at-sign and a home one bare", () => {
    const [away, home] = statRows(
      { a: line({ player_id: "a", team: "CIN" }), b: line({ player_id: "b", team: "BAL" }) },
      board,
      "ppr",
    );
    assert.equal(away.opponent, "@PIT");
    assert.equal(home.opponent, "CLE");
  });

  test("the clock is the seat rows' own reading, live and all", () => {
    const [, live] = statRows(
      { a: line({ player_id: "a", team: "CIN" }), b: line({ player_id: "b", team: "BAL" }) },
      board,
      "ppr",
    );
    assert.deepEqual(live.clock, { text: "Q3 08:04", live: true });
  });

  test("a team with no game on the board is a bye, and prints nothing", () => {
    // Not an em dash: in a column of clocks that reads as a game with no time
    // on it. `gameClockLabel`'s own call.
    const [bye] = statRows({ a: line({ player_id: "a", team: "DET" }) }, board, "ppr");
    assert.equal(bye.opponent, null);
    assert.equal(bye.clock.text, "");
  });

  test("a row the feed gave no team still joins nothing and still prices", () => {
    const [row] = statRows({ a: line({ player_id: "a", team: null, rec: 4, rec_yd: 40 }) }, board, "ppr");
    assert.equal(row.opponent, null);
    assert.equal(row.points, 8);
  });
});

describe("narrowStatRows", () => {
  const rows = [
    row({ player_id: "1", name: "Ja'Marr Chase", position: "WR", team: "CIN" }),
    row({ player_id: "2", name: "Josh Allen", position: "QB", team: "BUF" }),
    row({ player_id: "3", name: "James Cook", position: "RB", team: "BUF" }),
  ];

  test("nothing asked leaves everything", () => {
    assert.equal(narrowStatRows(rows, { query: "", position: "ALL", team: "ALL" }).length, 3);
  });

  test("the three narrowings are one AND", () => {
    const left = narrowStatRows(rows, { query: "o", position: "RB", team: "BUF" });
    assert.deepEqual(left.map((r) => r.player_id), ["3"]);
  });

  test("the search is a case-insensitive part of the name", () => {
    const left = narrowStatRows(rows, { query: "  CHASE ", position: "ALL", team: "ALL" });
    assert.deepEqual(left.map((r) => r.player_id), ["1"]);
  });

  test("a row with no name is narrowed away by a query and by nothing else", () => {
    const nameless = [row({ player_id: "x", name: null, team: "CIN", position: "WR" })];
    assert.equal(narrowStatRows(nameless, { query: "", position: "WR", team: "CIN" }).length, 1);
    assert.equal(narrowStatRows(nameless, { query: "a", position: "ALL", team: "ALL" }).length, 0);
  });
});

describe("statFiltersActive", () => {
  test("blank space is not a narrowing", () => {
    assert.equal(statFiltersActive({ query: "   ", position: "ALL", team: "ALL" }), false);
  });

  test("any one of the three is", () => {
    assert.equal(statFiltersActive({ query: "a", position: "ALL", team: "ALL" }), true);
    assert.equal(statFiltersActive({ query: "", position: "QB", team: "ALL" }), true);
    assert.equal(statFiltersActive({ query: "", position: "ALL", team: "BUF" }), true);
  });
});

describe("rankStatRows", () => {
  const rows = [
    row({ player_id: "1", name: "Chase", points: 37.8, rec: 11 }),
    row({ player_id: "2", name: "Allen", points: 31.9, rec: 0 }),
    row({ player_id: "3", name: "Bowers", points: 21.7, rec: 9 }),
  ];

  test("the rank is the row's place in this view, from one", () => {
    const ranked = rankStatRows(rows, "points", -1);
    assert.deepEqual(ranked.map((r) => [r.rank, r.player_id]), [[1, "1"], [2, "2"], [3, "3"]]);
  });

  test("it renumbers from one on a narrowing rather than carrying a stored place", () => {
    const ranked = rankStatRows(rows.slice(1), "points", -1);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
  });

  test("a flipped direction reverses a numeric column", () => {
    assert.deepEqual(
      rankStatRows(rows, "points", 1).map((r) => r.player_id),
      ["3", "2", "1"],
    );
  });

  test("ties break on the name, ascending, whichever way the column runs", () => {
    // Stable order over a record is the order the ids happened to arrive in —
    // a board that reshuffled its equal rows between frames with nothing on
    // screen having changed.
    const tied = [
      row({ player_id: "z", name: "Zeta", points: 10 }),
      row({ player_id: "a", name: "Alpha", points: 10 }),
    ];
    assert.deepEqual(rankStatRows(tied, "points", -1).map((r) => r.name), ["Alpha", "Zeta"]);
    assert.deepEqual(rankStatRows(tied, "points", 1).map((r) => r.name), ["Alpha", "Zeta"]);
  });

  test("a text column orders by its text", () => {
    assert.deepEqual(
      rankStatRows(rows, "name", 1).map((r) => r.name),
      ["Allen", "Bowers", "Chase"],
    );
  });

  test("an absent value sorts last in either direction", () => {
    // A player with no clock is not the earliest kickoff of the week, and
    // flipping the arrow must not make him one.
    const mixed = [
      row({ player_id: "1", name: "A", clock: { text: "Final", live: false } }),
      row({ player_id: "2", name: "B", clock: { text: "", live: false } }),
      row({ player_id: "3", name: "C", clock: { text: "Q1 10:00", live: true } }),
    ];
    assert.equal(rankStatRows(mixed, "clock", 1).at(-1)?.player_id, "2");
    assert.equal(rankStatRows(mixed, "clock", -1).at(-1)?.player_id, "2");
  });

  test("an unknown key falls back to the points column rather than to no order", () => {
    const ranked = rankStatRows(rows, "nonsense" as never, -1);
    assert.deepEqual(ranked.map((r) => r.player_id), ["1", "2", "3"]);
  });

  test("the rows handed in are not reordered", () => {
    const input = [...rows];
    rankStatRows(input, "name", 1);
    assert.deepEqual(input.map((r) => r.player_id), ["1", "2", "3"]);
  });
});

describe("statTeams", () => {
  test("distinct and sorted, and a row with no team offers none", () => {
    const rows = [
      row({ team: "CIN" }),
      row({ team: "BUF" }),
      row({ team: "CIN" }),
      row({ team: null }),
    ];
    assert.deepEqual(statTeams(rows), ["BUF", "CIN"]);
  });
});

describe("topStatRow", () => {
  test("the week's best, and null over nothing", () => {
    assert.equal(topStatRow([]), null);
    assert.equal(
      topStatRow([row({ name: "A", points: 4 }), row({ name: "B", points: 9 })])?.name,
      "B",
    );
  });
});

describe("statLineSummary", () => {
  test("only the groups he has a figure in", () => {
    assert.equal(
      statLineSummary(row({ pass_yd: 287, pass_td: 3, pass_int: 1, rush_yd: 44, rush_td: 1 })),
      "287 PA/3TD/1INT · 44 RU/1TD",
    );
    assert.equal(statLineSummary(row({ rec: 11, rec_yd: 148, rec_td: 2 })), "11-148/2TD");
    assert.equal(
      statLineSummary(row({ rush_yd: 104, rush_td: 2, rec: 4, rec_yd: 31 })),
      "104 RU/2TD · 4-31",
    );
  });

  test("a lost fumble is its own part", () => {
    assert.equal(statLineSummary(row({ rec: 5, rec_yd: 38, fumbles_lost: 1 })), "5-38 · 1 FUM");
  });
});

describe("the column table", () => {
  test("the grid template has one track per column, in order", () => {
    // Two lists would be a column landing in the wrong track the first time
    // somebody inserted one — every cell after it a place out, with nothing
    // failing and every figure under the wrong head.
    assert.equal(STAT_GRID_TEMPLATE.split(" ").length, STAT_COLUMNS.length);
    assert.equal(STAT_GRID_TEMPLATE.split(" ")[0], STAT_COLUMNS[0].width);
  });

  test("the group header's spans are the column runs, and cover every column", () => {
    const spans = statGroupSpans();
    assert.deepEqual(spans, [
      // The pinned first column is cut out of its run — a sticky cell keeps
      // its own width, so one spanning the four beside it would slide across
      // `Passing` and `Rushing` as the table scrolled.
      { group: null, span: 1 },
      { group: null, span: 4 },
      { group: "Passing", span: 3 },
      { group: "Rushing", span: 2 },
      { group: "Receiving", span: 3 },
      { group: null, span: 1 },
      { group: "Total", span: 1 },
    ]);
    assert.equal(
      spans.reduce((sum, s) => sum + s.span, 0),
      STAT_COLUMNS.length,
    );
  });

  test("every phone sort names a real column", () => {
    const keys = new Set(STAT_COLUMNS.map((c) => c.key));
    for (const key of PHONE_SORTS) assert.equal(keys.has(key), true, key);
  });

  test("a sort's label says which group it is from where the label alone would not", () => {
    assert.equal(sortLabel("points"), "Pts");
    assert.equal(sortLabel("pass_yd"), "Pass yds");
    assert.equal(sortLabel("rush_yd"), "Rush yds");
    assert.equal(sortLabel("rec_yd"), "Rec yds");
    assert.equal(sortLabel("rec"), "Rec");
    assert.equal(sortLabel("name"), "Player");
  });

  test("every position the board filters by has a column to be filtered in", () => {
    const positions: StatBoardPosition[] = ["QB", "RB", "WR", "TE"];
    assert.equal(positions.length, 4);
    assert.equal(STAT_COLUMNS.some((c) => c.key === "position"), true);
  });
});
