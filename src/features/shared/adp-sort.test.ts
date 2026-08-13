import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Relative with the extension, like the modules under test import each other:
// Node's test runner strips types but does not know the `@/*` aliases.
import { previewAdpValue } from "./adp-controls.ts";
import type { AdpBoardEntry, AdpPickRow } from "./adp-picks.ts";
import {
  type AdpSort,
  type AdpSortColumn,
  DEFAULT_ADP_SORT,
  adpSortColumns,
  isValueSort,
  nextAdpSort,
  resolveAdpSort,
  sortAdpEntries,
} from "./adp-sort.ts";
import { DEFAULT_LEAGUE_FILTERS } from "./league-filters/defaults.ts";
import type { AdpPlayerPayload } from "@/shared/contract";

/**
 * Ordering the ADP board.
 *
 * The claims worth pinning are the ones that are silent when wrong — a sorted
 * list looks sorted whatever it did with the rows it could not compare:
 *
 * - **The board's own merge survives as a column.** `adpBoardEntries` decides
 *   where a pick sits among the players, and the default sort must hand that
 *   back untouched rather than re-deriving it.
 * - **A row with no answer sinks in *both* directions.** An em dash is not a
 *   small number; treating it as one floats every unpriced kicker to the top of
 *   an ascending KTC column.
 * - **Every sort is total.** Ties fall back to the merge, so a column of em
 *   dashes still comes back in a fixed order rather than the engine's.
 * - **A value sort is not an ADP sort reversed.** For a player the two agree,
 *   which is exactly what makes the pick case easy to lose: a future pick
 *   carries a discount, so it is worth less than the rung it stands on.
 * - **A sort cannot outlive the column it names.** Toggling a board off takes
 *   two columns with it, and a list still ordered on one of them is a list in an
 *   order nothing on screen explains.
 */

const stats = (adp: number, picks = 10) => ({
  picks,
  adp,
  min_pick: 1,
  max_pick: 40,
  stdev: 2,
});

const player = (
  id: string,
  over: Partial<AdpPlayerPayload> = {},
): AdpPlayerPayload => ({
  player_id: id,
  name: `Player ${id}`,
  position: "WR",
  team: "SF",
  rookie: false,
  redraft: stats(50),
  dynasty: stats(50),
  ktc: null,
  ...over,
});

const pickStats = (adp: number, discount = 1) => ({
  adp,
  player: "A Rookie",
  player_id: "r1",
  overall: 1,
  discount,
  base: discount === 1 ? null : "2026",
  discountExact: true,
});

const pick = (key: string, over: Partial<AdpPickRow> = {}): AdpPickRow => ({
  key: `pick:${key}`,
  season: "2026",
  round: 1,
  slot: 1,
  label: `2026 1.0${key}`,
  redraft: pickStats(10),
  dynasty: pickStats(10),
  ktc: null,
  ktcExact: true,
  ...over,
});

const entries = (
  rows: readonly (AdpPlayerPayload | AdpPickRow)[],
): AdpBoardEntry[] =>
  rows.map((row) =>
    "player_id" in row
      ? { kind: "player", key: row.player_id, player: row }
      : { kind: "pick", key: row.key, pick: row },
  );

const ctx = {
  soleBoard: "redraft" as const,
  rules: DEFAULT_LEAGUE_FILTERS,
  steepness: 2.75,
};

/** The ids a sort produced, in order — a player's id or a pick's key. */
const order = (rows: readonly AdpBoardEntry[]): string[] =>
  rows.map((row) => (row.kind === "player" ? row.player.player_id : row.pick.label));

const sortBy = (
  rows: readonly AdpBoardEntry[],
  column: AdpSortColumn,
  direction: "asc" | "desc",
) => order(sortAdpEntries(rows, { column, direction }, ctx));

describe("the board's own order is a column", () => {
  const rows = entries([player("a"), player("b"), player("c")]);

  test("ascending is the merge, handed back untouched", () => {
    // Not merely equal — the *same array*. `adpBoardEntries` already did this
    // work and its result is a memo other things read; re-sorting it would be a
    // thousand comparisons to arrive back where it started.
    assert.equal(sortAdpEntries(rows, DEFAULT_ADP_SORT, ctx), rows);
  });

  test("descending reverses it, without touching the caller's array", () => {
    const reversed = sortAdpEntries(rows, { column: "rank", direction: "desc" }, ctx);
    assert.deepEqual(order(reversed), ["c", "b", "a"]);
    assert.deepEqual(order(rows), ["a", "b", "c"], "the input must not be mutated");
  });
});

describe("a row with no answer sinks either way", () => {
  const rows = entries([
    player("priced", { ktc: { sf: 5000, oneqb: 4000 } }),
    player("unpriced", { ktc: null }),
    player("cheap", { ktc: { sf: 100, oneqb: 90 } }),
  ]);

  test("descending puts the biggest first and the em dash last", () => {
    assert.deepEqual(sortBy(rows, "ktc_sf", "desc"), ["priced", "cheap", "unpriced"]);
  });

  test("ascending puts the smallest first and the em dash *still* last", () => {
    // The one that is easy to get wrong: `null` as a small number floats every
    // kicker KTC has never priced to the top of the column.
    assert.deepEqual(sortBy(rows, "ktc_sf", "asc"), ["cheap", "priced", "unpriced"]);
  });

  test("a player KTC knows and prices nowhere sinks with the rest", () => {
    // `foldKtcValues` keeps such a player in the map carrying two nulls, which
    // is a different fact from an id KTC has never heard of and the same answer
    // here.
    const known = entries([
      player("known", { ktc: { sf: null, oneqb: null } }),
      player("priced", { ktc: { sf: 10, oneqb: 10 } }),
    ]);
    assert.deepEqual(sortBy(known, "ktc_sf", "desc"), ["priced", "known"]);
    assert.deepEqual(sortBy(known, "ktc_sf", "asc"), ["priced", "known"]);
  });
});

describe("every sort is total", () => {
  test("ties fall back to the board's own order", () => {
    const rows = entries([player("a"), player("b"), player("c")]);
    // Every row unpriced, so the column can tell none of them apart.
    assert.deepEqual(sortBy(rows, "ktc_sf", "desc"), ["a", "b", "c"]);
    assert.deepEqual(sortBy(rows, "ktc_sf", "asc"), ["a", "b", "c"]);
  });

  test("a partial tie keeps the merge inside each group", () => {
    const rows = entries([
      player("a", { ktc: { sf: 100, oneqb: 1 } }),
      player("b", { ktc: { sf: 900, oneqb: 1 } }),
      player("c", { ktc: { sf: 100, oneqb: 1 } }),
    ]);
    assert.deepEqual(sortBy(rows, "ktc_sf", "desc"), ["b", "a", "c"]);
  });
});

describe("what each column reads", () => {
  test("ADP sorts its own market, and the other market cannot reach it", () => {
    const rows = entries([
      player("a", { redraft: stats(10), dynasty: stats(90) }),
      player("b", { redraft: stats(90), dynasty: stats(10) }),
    ]);
    assert.deepEqual(sortBy(rows, "adp_redraft", "asc"), ["a", "b"]);
    assert.deepEqual(sortBy(rows, "adp_dynasty", "asc"), ["b", "a"]);
  });

  test("Taken sorts the sample, which is the share's own ordering", () => {
    // The denominator is one number for the whole column, so sorting the
    // numerator is sorting the percentage — and needs no draft count threaded
    // through to be right.
    const rows = entries([
      player("few", { redraft: stats(20, 3) }),
      player("many", { redraft: stats(20, 300) }),
    ]);
    assert.deepEqual(sortBy(rows, "taken", "desc"), ["many", "few"]);
  });

  test("a pick has no Taken, because it was never on the board", () => {
    const rows = entries([pick("1"), player("a", { redraft: stats(20, 5) })]);
    assert.deepEqual(sortBy(rows, "taken", "desc"), ["a", "2026 1.01"]);
    assert.deepEqual(sortBy(rows, "taken", "asc"), ["a", "2026 1.01"]);
  });

  test("the name column sorts a pick by its label and a player by his name", () => {
    const rows = entries([player("z", { name: "Zeb" }), player("a", { name: "Abe" })]);
    assert.deepEqual(sortBy(rows, "name", "asc"), ["a", "z"]);
    assert.deepEqual(sortBy(rows, "name", "desc"), ["z", "a"]);
  });

  test("a player with no position sinks rather than sorting as an empty string", () => {
    const rows = entries([
      player("none", { position: null }),
      player("qb", { position: "QB" }),
    ]);
    assert.deepEqual(sortBy(rows, "position", "asc"), ["qb", "none"]);
  });
});

describe("a value sort is not an ADP sort reversed", () => {
  test("for players the two agree, which is what hides the pick case", () => {
    const rows = entries([player("late", { redraft: stats(90) }), player("early", { redraft: stats(2) })]);
    assert.deepEqual(sortBy(rows, "adp_redraft", "asc"), ["early", "late"]);
    assert.deepEqual(sortBy(rows, "value_redraft", "desc"), ["early", "late"]);
  });

  test("a discounted pick is worth less than the rung it stands on", () => {
    // Same average, so the ADP column cannot separate them; the value column
    // must, because a 2028 first is not worth what this year's is. That is the
    // whole reason the discount lands on the value and never on the ADP.
    const rows = entries([
      pick("far", { label: "2028 1st", redraft: pickStats(10, 0.5) }),
      pick("near", { label: "2026 1.01", redraft: pickStats(10, 1) }),
    ]);
    assert.deepEqual(sortBy(rows, "adp_redraft", "asc"), ["2028 1st", "2026 1.01"]);
    assert.deepEqual(sortBy(rows, "value_redraft", "desc"), ["2026 1.01", "2028 1st"]);
  });

  test("the value it sorts on is the one the cell draws", () => {
    // The agreement no type can carry: the comparator and the cell have to put
    // the same number on the screen and in the ordering.
    const rows = entries([pick("p", { redraft: pickStats(10, 0.5) })]);
    const sorted = sortAdpEntries(rows, { column: "value_redraft", direction: "desc" }, ctx);
    const only = sorted[0];
    assert.equal(only.kind, "pick");
    if (only.kind !== "pick") return;
    assert.equal(
      previewAdpValue(only.pick.redraft!.adp, ctx.rules, ctx.steepness) *
        only.pick.redraft!.discount,
      previewAdpValue(10, DEFAULT_LEAGUE_FILTERS, 2.75) * 0.5,
    );
  });

  test("only a value sort reads the curve", () => {
    // What `AdpBoard` gates the steepness dependency on: every other column is
    // invariant to the slider, so re-sorting a thousand rows per notch of a drag
    // would be work for an ordering that cannot change.
    assert.equal(isValueSort({ column: "value_redraft", direction: "desc" }), true);
    assert.equal(isValueSort({ column: "value_dynasty", direction: "asc" }), true);
    assert.equal(isValueSort({ column: "adp_redraft", direction: "asc" }), false);
    assert.equal(isValueSort(DEFAULT_ADP_SORT), false);
  });

  test("and the curve genuinely does not reorder a non-value column", () => {
    const rows = entries([player("a", { redraft: stats(2) }), player("b", { redraft: stats(90) })]);
    const flat = sortAdpEntries(rows, { column: "adp_redraft", direction: "asc" }, { ...ctx, steepness: 0.5 });
    const steep = sortAdpEntries(rows, { column: "adp_redraft", direction: "asc" }, { ...ctx, steepness: 6 });
    assert.deepEqual(order(flat), order(steep));
  });
});

describe("a press picks the direction that answers the question", () => {
  test("a new column opens the way a reader means it", () => {
    // Pressing KTC to find the expensive players, and ADP to find pick 1.
    assert.deepEqual(nextAdpSort(DEFAULT_ADP_SORT, "ktc_sf"), {
      column: "ktc_sf",
      direction: "desc",
    });
    assert.deepEqual(nextAdpSort(DEFAULT_ADP_SORT, "adp_dynasty"), {
      column: "adp_dynasty",
      direction: "asc",
    });
    assert.deepEqual(nextAdpSort(DEFAULT_ADP_SORT, "name"), {
      column: "name",
      direction: "asc",
    });
  });

  test("the same column flips, both ways", () => {
    const first = nextAdpSort(DEFAULT_ADP_SORT, "taken");
    assert.equal(first.direction, "desc");
    const second = nextAdpSort(first, "taken");
    assert.equal(second.direction, "asc");
    assert.deepEqual(nextAdpSort(second, "taken"), first);
  });

  test("every column has a natural direction, so none opens on a two-press reading", () => {
    for (const column of adpSortColumns(true, "redraft")) {
      const next = nextAdpSort({ column: "name", direction: "asc" }, column);
      assert.ok(
        next.direction === "asc" || next.direction === "desc",
        `${column} must name a direction`,
      );
    }
  });
});

describe("a sort cannot outlive the column it names", () => {
  test("both boards draw no Taken column", () => {
    assert.ok(!adpSortColumns(true, "redraft").includes("taken"));
    assert.ok(adpSortColumns(false, "redraft").includes("taken"));
  });

  test("a single board draws only its own market's columns", () => {
    const redraft = adpSortColumns(false, "redraft");
    assert.ok(redraft.includes("adp_redraft"));
    assert.ok(redraft.includes("value_redraft"));
    assert.ok(!redraft.includes("adp_dynasty"));
    assert.ok(!redraft.includes("value_dynasty"));
  });

  test("the KTC pair is in every mode — it is not a fact about either market", () => {
    for (const columns of [
      adpSortColumns(true, "redraft"),
      adpSortColumns(false, "redraft"),
      adpSortColumns(false, "dynasty"),
    ]) {
      assert.ok(columns.includes("ktc_sf"));
      assert.ok(columns.includes("ktc_oneqb"));
    }
  });

  test("a sort whose column has left the screen falls back to the merge", () => {
    const taken: AdpSort = { column: "taken", direction: "desc" };
    // Toggling the second board on takes Taken with it.
    assert.deepEqual(resolveAdpSort(taken, true, "redraft"), DEFAULT_ADP_SORT);
    // And toggling to the other market takes that market's ADP column.
    const dynasty: AdpSort = { column: "adp_dynasty", direction: "asc" };
    assert.deepEqual(resolveAdpSort(dynasty, false, "redraft"), DEFAULT_ADP_SORT);
  });

  test("a sort that is still drawn is handed back unchanged", () => {
    // The same object, which is what keeps the board's scroll from resetting on
    // a render that changed nothing about the order.
    const sort: AdpSort = { column: "ktc_oneqb", direction: "desc" };
    assert.equal(resolveAdpSort(sort, true, "redraft"), sort);
    assert.equal(resolveAdpSort(sort, false, "dynasty"), sort);
  });
});

describe("picks and players sort together", () => {
  test("a KTC sort interleaves them on KTC's own numbers", () => {
    // A pick's KTC price is KTC's own row for the pick, not this board's
    // reading of one — so the column compares like with like.
    const rows = entries([
      player("a", { ktc: { sf: 5000, oneqb: 5000 } }),
      pick("1", { ktc: { sf: 7000, oneqb: 6500 } }),
      player("b", { ktc: { sf: 1000, oneqb: 1000 } }),
    ]);
    assert.deepEqual(sortBy(rows, "ktc_sf", "desc"), ["2026 1.01", "a", "b"]);
  });

  test("a pick KTC cannot price sinks like any other unpriced row", () => {
    const rows = entries([
      pick("1", { ktc: null }),
      player("a", { ktc: { sf: 10, oneqb: 10 } }),
    ]);
    assert.deepEqual(sortBy(rows, "ktc_sf", "desc"), ["a", "2026 1.01"]);
  });
});
