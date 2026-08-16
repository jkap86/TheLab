import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_LINEUP_COLUMNS,
  LINEUP_METRICS,
  type LineupMetricContext,
} from "./lineup-metrics.ts";
import type { MatchupProjection } from "./types.ts";

/**
 * The lineup columns' catalogue, read without a card around it.
 *
 * What is worth pinning here is the *sign* and the three readings, because all
 * three are decisions a type cannot carry: the column answers `current − optimal`
 * rather than the `optimal − current` the contract sends and the panel prints, so
 * a refactor that reached for `points_left` directly would flip every row on the
 * page and still compile. Beside it, zero and absent are different answers — the
 * rule every projected number in this app keeps — and only one of the three is a
 * verdict worth tinting.
 */

const metric = (key: string) => {
  const found = LINEUP_METRICS.find((m) => m.key === key);
  assert.ok(found, `no ${key} metric`);
  return found;
};

const ctx = (projection: MatchupProjection | null): LineupMetricContext => ({
  matchup: {
    roster_id: 1,
    opponent: null,
    projection,
    opponent_projection: null,
    median_projection: null,
  },
});

/** A projection with the kickoff count defaulted, for the tests it is beside the point of. */
const proj = (
  over: Pick<MatchupProjection, "optimal" | "current" | "points_left"> &
    Partial<MatchupProjection>,
): MatchupProjection => ({ kickoff_moves: null, ...over });

/** The named metric's cell as a value cell, the only shape this catalogue returns. */
const cellOf = (key: string, context: LineupMetricContext) => {
  const cell = metric(key).cell(context);
  assert.equal(cell.kind, "value");
  return cell as Extract<typeof cell, { kind: "value" }>;
};

const value = (context: LineupMetricContext) => cellOf("vs_optimal", context);

describe("vs optimal", () => {
  test("reads as a shortfall against the best lineup, not a bonus toward it", () => {
    // The inversion this column exists for. `points_left` is `optimal − current`
    // and the column is `current − optimal`, so a bench holding 12.34 points puts
    // the lineup 12.34 *behind* — which is what a minus in front of a number
    // means everywhere else in this app.
    const cell = value(ctx(proj({ optimal: 132.5, current: 120.16, points_left: 12.34 })));
    assert.equal(cell.text, "-12.34");
    assert.equal(cell.tone, "alert");
  });

  test("names both totals and the gap on the hover", () => {
    // The column has room for one number; what it is measured against is the
    // thing a reader needs before acting on it.
    const cell = value(ctx(proj({ optimal: 132.5, current: 120.16, points_left: 12.34 })));
    assert.match(cell.title, /120\.16/);
    assert.match(cell.title, /132\.50/);
    assert.match(cell.title, /12\.34/);
  });

  test("an optimal lineup is a word, and carries no verdict", () => {
    // Zero is a real answer and a good one — the team is already starting the
    // best lineup available — where a run of `-0.00` down a list reads as
    // numbers that failed to arrive. Untinted, since there is nothing to do.
    const cell = value(ctx(proj({ optimal: 120, current: 120, points_left: 0 })));
    assert.equal(cell.text, "set");
    assert.equal(cell.tone, undefined);
  });

  test("no projection is an em dash, never a zero", () => {
    // A league with no slots or scoring on file, and a week nothing is stored
    // for, are both "no answer" — which this app spells one way, and never as a
    // lineup that happens to be perfect.
    assert.equal(value(ctx(null)).text, null);
    assert.equal(value({ matchup: null }).text, null);
    assert.equal(value({ matchup: null }).tone, undefined);
  });
});

describe("kickoff", () => {
  test("counts the seats to trade, and it is a verdict", () => {
    const cell = cellOf(
      "kickoff",
      ctx(proj({ optimal: 120, current: 120, points_left: 0, kickoff_moves: 2 })),
    );
    assert.equal(cell.text, "2 to move");
    assert.equal(cell.tone, "alert");
  });

  test("a lineup already in order is a word, untinted", () => {
    // Zero is a real answer and a good one — strict seats lock first, the
    // flexes stay open — where a column of `0`s reads as a metric with nothing
    // to say.
    const cell = cellOf(
      "kickoff",
      ctx(proj({ optimal: 120, current: 120, points_left: 0, kickoff_moves: 0 })),
    );
    assert.equal(cell.text, "in order");
    assert.equal(cell.tone, undefined);
  });

  test("no ordering is an em dash, never `in order`", () => {
    // Null is best ball or a week with no schedule instants — claiming those
    // lineups are already ordered would be the one wrong answer that looks
    // like a working one. So is a league with no projection at all.
    const unordered = cellOf(
      "kickoff",
      ctx(proj({ optimal: 120, current: 120, points_left: 0 })),
    );
    assert.equal(unordered.text, null);
    assert.equal(unordered.tone, undefined);
    assert.equal(cellOf("kickoff", ctx(null)).text, null);
    assert.equal(cellOf("kickoff", { matchup: null }).text, null);
  });

  test("one move reads singular on the hover", () => {
    const cell = cellOf(
      "kickoff",
      ctx(proj({ optimal: 120, current: 120, points_left: 0, kickoff_moves: 1 })),
    );
    assert.equal(cell.text, "1 to move");
    assert.match(cell.title, /1 starter could/);
  });
});

describe("the blank column", () => {
  test("prints nothing and says so, so a heading has a name to press", () => {
    const cell = metric("blank").cell({ matchup: null });
    assert.equal(cell.kind, "value");
    assert.equal(cell.kind === "value" && cell.text, null);
    assert.equal(metric("blank").label, "Blank");
  });
});

describe("the default board", () => {
  test("opens on the shortfall and the kickoff order, and leaves the rest blank", () => {
    assert.deepEqual(DEFAULT_LINEUP_COLUMNS, [
      "vs_optimal",
      "kickoff",
      "blank",
      "blank",
    ]);
  });

  test("every default names a metric this catalogue holds", () => {
    // `resolveColumns` falls an unknown key back per slot, so a typo here is a
    // column that silently draws something else rather than an error.
    const known = new Set(LINEUP_METRICS.map((m) => m.key));
    for (const key of DEFAULT_LINEUP_COLUMNS) assert.ok(known.has(key), key);
  });
});
