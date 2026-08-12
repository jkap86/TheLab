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
  matchup: { roster_id: 1, opponent: null, projection, opponent_projection: null },
});

/** The cell as a value cell, which is the only shape this catalogue returns. */
const value = (context: LineupMetricContext) => {
  const cell = metric("vs_optimal").cell(context);
  assert.equal(cell.kind, "value");
  return cell as Extract<typeof cell, { kind: "value" }>;
};

describe("vs optimal", () => {
  test("reads as a shortfall against the best lineup, not a bonus toward it", () => {
    // The inversion this column exists for. `points_left` is `optimal − current`
    // and the column is `current − optimal`, so a bench holding 12.34 points puts
    // the lineup 12.34 *behind* — which is what a minus in front of a number
    // means everywhere else in this app.
    const cell = value(ctx({ optimal: 132.5, current: 120.16, points_left: 12.34 }));
    assert.equal(cell.text, "-12.34");
    assert.equal(cell.tone, "alert");
  });

  test("names both totals and the gap on the hover", () => {
    // The column has room for one number; what it is measured against is the
    // thing a reader needs before acting on it.
    const cell = value(ctx({ optimal: 132.5, current: 120.16, points_left: 12.34 }));
    assert.match(cell.title, /120\.16/);
    assert.match(cell.title, /132\.50/);
    assert.match(cell.title, /12\.34/);
  });

  test("an optimal lineup is a word, and carries no verdict", () => {
    // Zero is a real answer and a good one — the team is already starting the
    // best lineup available — where a run of `-0.00` down a list reads as
    // numbers that failed to arrive. Untinted, since there is nothing to do.
    const cell = value(ctx({ optimal: 120, current: 120, points_left: 0 }));
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

describe("the blank column", () => {
  test("prints nothing and says so, so a heading has a name to press", () => {
    const cell = metric("blank").cell({ matchup: null });
    assert.equal(cell.kind, "value");
    assert.equal(cell.kind === "value" && cell.text, null);
    assert.equal(metric("blank").label, "Blank");
  });
});

describe("the default board", () => {
  test("opens on the shortfall and leaves the rest blank", () => {
    assert.deepEqual(DEFAULT_LINEUP_COLUMNS, [
      "vs_optimal",
      "blank",
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
