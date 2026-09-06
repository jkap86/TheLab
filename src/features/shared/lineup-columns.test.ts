import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  adpBoardLabel,
  cellGapReason,
  column,
  COLUMN_SCOPES,
  COLUMN_VALUES,
  DEFAULT_LINEUP_COLUMNS,
  IDP_LINEUP_POSITIONS,
  ktcBoardLabel,
  ktcChoiceLabel,
  LINEUP_METRIC_IDS,
  LINEUP_METRIC_LABELS,
  LINEUP_POSITION_LABELS,
  LINEUP_POSITIONS,
  MAX_LINEUP_COLUMNS,
  metricAt,
  metricAxes,
  normalizeLineupColumns,
  positionGapReason,
  positionsClause,
  positionsLabel,
} from "./lineup-columns.ts";
import {
  isKtcMetric,
  lineupColumnKey,
  readsQbBoard,
} from "../../shared/ktc/columns.ts";

/**
 * The rules a stored column selection is read by, all of which are silent when
 * they go wrong.
 *
 * The hook and the write are not exercised here — they are `local-store`'s, and
 * that file's own contract is what they follow. What is tested is the pure half
 * both ends share: a selection lost on upgrade, a second bay that quietly
 * deletes the first, a fifth column, and a rack with a socket the picker cannot
 * draw.
 */

/** What each bay actually holds, which is its key rather than its metric. */
const keysOf = (value: unknown): string[] =>
  normalizeLineupColumns(value).map(lineupColumnKey);

describe("normalizeLineupColumns", () => {
  test("a legacy string[] reads as columns on every axis's default", () => {
    // The axes did not exist when the value was written, and `auto` on both
    // markets and the empty position set are what the page was doing anyway —
    // so nobody's stored selection moves on upgrade.
    const chosen = normalizeLineupColumns(["ros_starters", "ktc_total"]);
    assert.deepEqual(
      chosen.filter((c) => c.metric === "ros_starters"),
      [column("ros_starters")],
    );
    assert.deepEqual(
      chosen.filter((c) => c.metric === "ktc_total"),
      [column("ktc_total")],
    );
  });

  test("two KTC columns on two boards both survive", () => {
    // The whole point of the shape: a reader comparing one roster's superflex
    // worth against its 1QB worth is asking two questions.
    const held = keysOf([
      column("ktc_total", "dynasty", "sf"),
      column("ktc_total", "dynasty", "oneqb"),
    ]);
    assert.ok(held.includes("ktc_total:dynasty:sf"));
    assert.ok(held.includes("ktc_total:dynasty:oneqb"));
  });

  test("the same board twice is one column", () => {
    const held = keysOf([
      column("ktc_total", "dynasty", "sf"),
      column("ktc_total", "dynasty", "sf"),
    ]);
    assert.equal(held.filter((k) => k === "ktc_total:dynasty:sf").length, 1);
  });

  test("a projection cannot occupy two bays", () => {
    // `column` forces both axes to auto on the three, so a hand-edited value
    // carrying a board on one folds back onto the column already there.
    const chosen = normalizeLineupColumns([
      column("ros_starters"),
      { metric: "ros_starters", format: "dynasty", lineup: "sf" },
    ]);
    assert.equal(chosen.filter((c) => c.metric === "ros_starters").length, 1);
  });

  test("two capital columns on two ADP boards both survive", () => {
    // The same shape one valuation over: the ADP fold splits superflex drafts
    // from standard ones, so pricing a roster's capital on both is the
    // comparison the KTC bays already make on two markets.
    const held = keysOf([
      column("capital_total", "auto", "sf"),
      column("capital_total", "auto", "oneqb"),
    ]);
    assert.ok(held.includes("capital_total:sf"));
    assert.ok(held.includes("capital_total:oneqb"));
  });

  test("a capital column carrying a market folds onto the one already there", () => {
    // Draft capital has no market to read, so a stray one must not become a
    // second, un-removable copy of a column the reader cannot tell apart. Asked
    // of the *keys*, because the two survivors of a short selection are its own
    // column and whatever `toppedUp` put beside it.
    const held = keysOf([
      column("capital_total", "auto", "sf"),
      { metric: "capital_total", format: "dynasty", lineup: "sf" },
    ]);
    assert.equal(held.filter((k) => k === "capital_total:sf").length, 1);
    assert.ok(!held.some((k) => k.startsWith("capital_total:dynasty")));
  });

  test("caps at the budget", () => {
    assert.equal(
      normalizeLineupColumns(LINEUP_METRIC_IDS).length,
      MAX_LINEUP_COLUMNS,
    );
  });

  test("and tops a short selection back up to it", () => {
    // **The cap means *exactly* four now**, which is the rack losing its empty
    // socket: a selection of three is a bay the picker cannot draw and cannot
    // offer a way to fill. Enforced on read as well as on write, since the short
    // value may be one a build predating the change wrote or one a reader's own
    // hand-edit left.
    for (const n of [0, 1, 2, 3]) {
      assert.equal(
        normalizeLineupColumns(LINEUP_METRIC_IDS.slice(0, n)).length,
        MAX_LINEUP_COLUMNS,
        `${n} stored`,
      );
    }
  });

  test("what it tops up with is the defaults, then the rest of the grid", () => {
    // So a reader whose stored value held one column keeps it and gains the
    // defaults they were missing, rather than a metric nobody chose.
    assert.deepEqual(
      normalizeLineupColumns(["ros_starters", "not_a_metric", null, 7]),
      DEFAULT_LINEUP_COLUMNS,
    );
  });

  test("never empty, and never a garbage column", () => {
    assert.deepEqual(normalizeLineupColumns([]), DEFAULT_LINEUP_COLUMNS);
    assert.deepEqual(normalizeLineupColumns("nope"), DEFAULT_LINEUP_COLUMNS);
  });

  test("orders canonically, and stably where one metric holds two bays", () => {
    const ordered = normalizeLineupColumns([
      column("ktc_total", "redraft", "auto"),
      column("ros_bench"),
      column("ktc_total", "dynasty", "sf"),
    ]);
    assert.deepEqual(
      ordered.map((c) => c.metric),
      // The fourth is the top-up: `ros_starters`, the first default not held.
      ["ros_starters", "ros_bench", "ktc_total", "ktc_total"],
    );
    // The two bays on one metric are ordered by their key, which is the same
    // string the card looks each rank up by — so the order cannot invent a
    // third identity.
    assert.deepEqual(
      ordered.slice(2).map((c) => c.format),
      ["dynasty", "redraft"],
    );
  });
});

/**
 * The third axis, read back off a stored value.
 *
 * Every rule here is silent when it goes wrong in the worst way an axis can be:
 * a rank is a plausible number whichever question produced it, so a narrowing
 * lost, doubled or reordered on read is a figure that looks right and answers
 * something else.
 */
describe("the position axis, stored", () => {
  test("an entry with no positions field reads as the empty set", () => {
    // Which is what keeps every existing reader's selection through the change:
    // the axis did not exist when the value was written, and "every position" is
    // what the page was doing anyway. It is the same rule one grain older that
    // reads a legacy bare string as a triple on `auto`.
    const [first] = normalizeLineupColumns([
      { metric: "ros_starters", format: "auto", lineup: "auto" },
    ]);
    assert.deepEqual(first.positions, []);
  });

  test("an un-narrowed column keys exactly as it did before the axis", () => {
    // The ten base ranks the route always ships are filed under bare metric
    // ids, so appending an `all` token to every key would rename every one of
    // them — a card looking up a rank the server computed under another name,
    // and an em dash where a number was.
    assert.equal(lineupColumnKey(column("ros_starters")), "ros_starters");
    assert.equal(lineupColumnKey(column("ktc_total")), "ktc_total");
  });

  test("two bays narrowed to different positions are two columns", () => {
    const held = keysOf([
      column("ktc_starters", "auto", "auto", ["QB"]),
      column("ktc_starters", "auto", "auto", ["TE"]),
    ]);
    assert.ok(held.includes("ktc_starters:qb"));
    assert.ok(held.includes("ktc_starters:te"));
  });

  test("a set is deduped, dropped of unknowns and canonically ordered", () => {
    // Press order would make one column read two ways — the bay's second line
    // and the card's tile both print this list.
    // Found by key rather than by index, because the top-up puts the
    // *un-narrowed* `ros_starters` in the rack beside this one — they are two
    // columns, which is the axis working rather than a duplicate.
    const narrowed = normalizeLineupColumns([
      { metric: "ros_starters", positions: ["te", "QB", "TE", "OP", 7, null] },
    ]).find((c) => c.positions.length > 0);
    assert.deepEqual(narrowed?.positions, ["QB", "TE"]);
    assert.equal(lineupColumnKey(narrowed!), "ros_starters:qb+te");
  });

  test("the same two positions in two press orders are one column", () => {
    const held = keysOf([
      column("ros_bench", "auto", "auto", ["QB", "TE"]),
      column("ros_bench", "auto", "auto", ["TE", "QB"]),
    ]);
    assert.equal(held.filter((k) => k === "ros_bench:qb+te").length, 1);
  });

  test("a draft-pick column can never carry one", () => {
    // A pick is not a player and has no position yet, which is the same fact the
    // scope axis states by having `Picks` live under KeepTradeCut alone. Forced
    // in the constructor rather than guarded at each caller, so a stored value
    // carrying one cannot become a key nothing ranks.
    assert.deepEqual(
      column("ktc_picks", "auto", "auto", ["QB"]).positions,
      [],
    );
    assert.equal(lineupColumnKey(column("ktc_picks")), "ktc_picks");
  });
});

/** The axis's own words, which the bay, the card's tile and the sentence share. */
describe("the position axis, spoken", () => {
  test("every position offered has a label, and the IDP three are among them", () => {
    for (const one of LINEUP_POSITIONS) {
      assert.ok(LINEUP_POSITION_LABELS[one]?.length, one);
    }
    // The hairlines are read off the vocabulary rather than spelled as indices,
    // so a position the solver learns lands on the right side of the cut.
    for (const one of IDP_LINEUP_POSITIONS) {
      assert.ok(LINEUP_POSITIONS.includes(one), one);
    }
  });

  test("the label is slash-joined and the clause is a sentence's tail", () => {
    // Two spellings of one set, because a 59px tile line and a `Reads` sentence
    // cannot be the same string — and one function each, so the two surfaces
    // cannot come to describe one column two ways.
    assert.equal(positionsLabel([]), "");
    assert.equal(positionsLabel(["QB", "TE"]), "QB/TE");
    assert.equal(positionsClause([]), "");
    assert.equal(positionsClause(["QB"]), " QB only.");
    assert.equal(positionsClause(["QB", "TE"]), " QB and TE only.");
    assert.equal(positionsClause(["RB", "WR", "DB"]), " RB, WR and DB only.");
  });

  test("only a picks column refuses the axis, and says why", () => {
    for (const scope of COLUMN_SCOPES) {
      assert.equal(positionGapReason(scope) === null, scope !== "picks", scope);
    }
    assert.match(positionGapReason("picks")!, /draft pick/);
  });
});

describe("which axes a column carries", () => {
  test("a projection takes neither, capital takes the board, KTC takes both", () => {
    // `column` is the one constructor, so an axis a metric cannot read is
    // forced to `auto` here rather than guarded at each call site — which is
    // what lets `lineupColumnKey` fold it out of the key.
    const proj = column("ros_total", "dynasty", "sf");
    assert.equal(proj.format, "auto");
    assert.equal(proj.lineup, "auto");

    const capital = column("capital_bench", "dynasty", "sf");
    assert.equal(capital.format, "auto");
    assert.equal(capital.lineup, "sf");

    const ktc = column("ktc_bench", "dynasty", "sf");
    assert.equal(ktc.format, "dynasty");
    assert.equal(ktc.lineup, "sf");
  });

  test("and the picker draws a QB track for exactly the ones that keep it", () => {
    for (const id of LINEUP_METRIC_IDS) {
      assert.equal(
        column(id, "auto", "sf").lineup === "sf",
        readsQbBoard(id),
        id,
      );
    }
  });
});

describe("the labels", () => {
  test("every metric is placed, and only the KTC four spend line two", () => {
    // The tile's second line carries the scope, except on the four metrics
    // where the market pair takes it — and `isKtcMetric` is what says which,
    // rather than the emptiness being read as a signal. A capital column reads
    // a board too, but it keeps its scope word: see `tileScope`, where the
    // board joins it only once a reader has forced one.
    for (const id of LINEUP_METRIC_IDS) {
      const words = LINEUP_METRIC_LABELS[id];
      assert.ok(words.unit.length > 0, id);
      assert.ok(words.column.length > 0, id);
      assert.equal(words.scope === "", isKtcMetric(id), id);
    }
  });

  test("a capital bay names its board only once one is forced", () => {
    // `Auto` there would spend a third of a 72px line saying "nothing was
    // forced" in a rack where nothing is forced by default — where a KTC bay
    // has nothing else to put on the line and spells the rule out.
    assert.equal(adpBoardLabel("auto"), "");
    assert.equal(adpBoardLabel("sf"), "SF");
    assert.equal(adpBoardLabel("oneqb"), "1QB");
  });

  test("a setting reads as a rule and a reading names a board", () => {
    assert.equal(ktcChoiceLabel(column("ktc_total")), "Auto · Auto");
    assert.equal(
      ktcChoiceLabel(column("ktc_total", "dynasty", "sf")),
      "Dyn · SF",
    );
    assert.equal(ktcBoardLabel("dynasty", true), "Dyn·SF");
    assert.equal(ktcBoardLabel("redraft", false), "Red·1QB");
  });
});

/**
 * The grid the picker composes a column from — a value crossed with a scope.
 *
 * Every rule here is silent when it goes wrong: a metric that named one cell in
 * the table and another in the lookup would be a key that lights on a column it
 * does not set, and a hole with no reason attached would be a greyed key a
 * reader cannot find out anything about.
 */
describe("the value × scope grid", () => {
  test("every metric round-trips through its own cell", () => {
    // `metricAt` is derived from `METRIC_AXES` rather than written beside it,
    // and this is what says the derivation is total: no id is unreachable from
    // the two keys a reader presses.
    for (const id of LINEUP_METRIC_IDS) {
      const { value, scope } = metricAxes(id);
      assert.equal(metricAt(value, scope), id, id);
    }
  });

  test("the whole-roster projection has a cell", () => {
    // It was the grid's other hole and is a metric now: the picker made the
    // absence legible, which is what a two-axis composer is for.
    assert.equal(metricAt("projection", "all"), "ros_total");
    assert.deepEqual(metricAxes("ros_total"), {
      value: "projection",
      scope: "all",
    });
  });

  test("no two metrics share a cell", () => {
    const seen = new Set(
      LINEUP_METRIC_IDS.map((id) => {
        const { value, scope } = metricAxes(id);
        return `${value}:${scope}`;
      }),
    );
    assert.equal(seen.size, LINEUP_METRIC_IDS.length);
  });

  test("the two holes are the two the design names, and no others", () => {
    const holes: string[] = [];
    for (const value of COLUMN_VALUES) {
      for (const scope of COLUMN_SCOPES) {
        if (!metricAt(value, scope)) holes.push(`${value}:${scope}`);
      }
    }
    // Only KeepTradeCut prices a pick, so picks are absent under the other two
    // bases — and that is the grid's one remaining gap since `ros_total` filled
    // `projection:all`. Anything else appearing here is a metric that quietly
    // stopped being reachable.
    assert.deepEqual(holes.sort(), ["capital:picks", "projection:picks"]);
  });

  test("a hole always carries a reason and a cell never does", () => {
    for (const value of COLUMN_VALUES) {
      for (const scope of COLUMN_SCOPES) {
        const reason = cellGapReason(value, scope);
        assert.equal(
          reason === null,
          metricAt(value, scope) !== null,
          `${value}:${scope}`,
        );
        if (reason !== null) assert.ok(reason.length > 0);
      }
    }
    // The gap that is left is a reading that cannot exist on that basis at all,
    // rather than one this app has not built — which is why it names the basis
    // that *can* answer it.
    assert.equal(cellGapReason("projection", "all"), null);
    assert.match(cellGapReason("capital", "picks")!, /KeepTradeCut/);
  });
});
