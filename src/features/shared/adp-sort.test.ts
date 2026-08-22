import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Relative with the extension, like the modules under test import each other:
// Node's test runner strips types but does not know the `@/*` aliases.
import { previewAdpValue } from "./adp-controls.ts";
import type { AdpBoardEntry, AdpPickRow } from "./adp-picks.ts";
import {
  type AdpSort,
  type AdpSortColumn,
  type AdpSortContext,
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
 *   small number; treating it as one floats every player the crawled auctions
 *   never bought to the top of an ascending Bid column.
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
  // The crawled auctions bought nobody by default: they are a small slice of
  // the corpus, so both boards null is the ordinary row rather than a case.
  auction: { redraft: null, dynasty: null },
  ...over,
});

/** One board's auction reading: a share of the room's budget, and its sample. */
const bid = (share: number, buys = 5) => ({
  buys,
  share,
  min_share: Math.max(0, share - 5),
  max_share: share + 5,
  stdev: 2,
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

// Typed as the context rather than inferred, so a case can point the
// single-board columns at the other market.
const ctx: AdpSortContext = {
  soleBoard: "redraft",
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
  // The lit market, for the columns that read one — everything else takes the
  // default so the cases that do not care stay two arguments long.
  over: Partial<AdpSortContext> = {},
) => order(sortAdpEntries(rows, { column, direction }, { ...ctx, ...over }));

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
    player("dear", { auction: { redraft: bid(58), dynasty: null } }),
    player("unbought", { auction: { redraft: null, dynasty: null } }),
    player("cheap", { auction: { redraft: bid(2), dynasty: null } }),
  ]);

  test("descending puts the biggest first and the em dash last", () => {
    assert.deepEqual(sortBy(rows, "auction_redraft", "desc"), [
      "dear",
      "cheap",
      "unbought",
    ]);
  });

  test("ascending puts the smallest first and the em dash *still* last", () => {
    // The one that is easy to get wrong: `null` as a small number floats every
    // player the crawled auctions never bought to the top of the column — and
    // that is most of a board, since auctions are a small slice of the corpus.
    assert.deepEqual(sortBy(rows, "auction_redraft", "asc"), [
      "cheap",
      "dear",
      "unbought",
    ]);
  });

  test("a row priced on the other market only sinks with the rest", () => {
    // Bought at auction, just not in a room on this board — a different fact
    // from never bought and the same answer in this column.
    const known = entries([
      player("other", { auction: { redraft: null, dynasty: bid(90) } }),
      player("here", { auction: { redraft: bid(10), dynasty: null } }),
    ]);
    assert.deepEqual(sortBy(known, "auction_redraft", "desc"), ["here", "other"]);
    assert.deepEqual(sortBy(known, "auction_redraft", "asc"), ["here", "other"]);
  });
});

describe("every sort is total", () => {
  test("ties fall back to the board's own order", () => {
    const rows = entries([player("a"), player("b"), player("c")]);
    // No row was bought, so the column can tell none of them apart.
    assert.deepEqual(sortBy(rows, "auction_redraft", "desc"), ["a", "b", "c"]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "asc"), ["a", "b", "c"]);
  });

  test("a partial tie keeps the merge inside each group", () => {
    const rows = entries([
      player("a", { auction: { redraft: bid(10), dynasty: null } }),
      player("b", { auction: { redraft: bid(90), dynasty: null } }),
      player("c", { auction: { redraft: bid(10), dynasty: null } }),
    ]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "desc"), ["b", "a", "c"]);
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

  test("Bid sorts the share the cell draws, not the sample behind it", () => {
    // The opposite call from Taken, and deliberately: an auction share's
    // denominator is the *room's* budget, so it is per row rather than one
    // number for the whole column — sorting the sample would order the board by
    // how often a player is auctioned, which is a different question.
    const rows = entries([
      player("dear", { auction: { redraft: bid(58, 2), dynasty: null } }),
      player("cheap", { auction: { redraft: bid(4, 40), dynasty: null } }),
    ]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "desc"), ["dear", "cheap"]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "asc"), ["cheap", "dear"]);
  });

  test("Bid sorts its own market, and the other market cannot reach it", () => {
    // Board-qualified rather than read off the lit board, which is what lets the
    // pair stand side by side with both markets up: one column per market, each
    // ordering the shares it actually draws.
    const rows = entries([
      player("a", { auction: { redraft: bid(10), dynasty: bid(90) } }),
      player("b", { auction: { redraft: bid(90), dynasty: bid(10) } }),
    ]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "desc"), ["b", "a"]);
    assert.deepEqual(sortBy(rows, "auction_dynasty", "desc"), ["a", "b"]);
  });

  test("a row the crawled auctions never bought sinks either way", () => {
    // An em dash is the common row here rather than the exception — auctions are
    // a small slice of the corpus — so it must not float to the top of an
    // ascending press.
    const rows = entries([
      player("none"),
      player("some", { auction: { redraft: bid(12), dynasty: null } }),
    ]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "asc"), ["some", "none"]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "desc"), ["some", "none"]);
  });

  test("a pick has no Bid either — what an auction sells is players", () => {
    const rows = entries([
      pick("1"),
      player("a", { auction: { redraft: bid(20), dynasty: null } }),
    ]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "desc"), ["a", "2026 1.01"]);
    assert.deepEqual(sortBy(rows, "auction_redraft", "asc"), ["a", "2026 1.01"]);
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
    // Pressing Bid to find the players a room emptied its budget on, and ADP to
    // find pick 1.
    assert.deepEqual(nextAdpSort(DEFAULT_ADP_SORT, "auction_redraft"), {
      column: "auction_redraft",
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

  test("both boards draw a Bid column each, and Taken is the only one they drop", () => {
    // The share is per market, so two boards want two of these — which is what
    // the tracks KTC's pair used to hold were spent on. Taken is the one that
    // genuinely cannot come along: its column is where the second ADP goes.
    const both = adpSortColumns(true, "redraft");
    assert.ok(both.includes("auction_redraft"));
    assert.ok(both.includes("auction_dynasty"));
    assert.ok(adpSortColumns(false, "dynasty").includes("auction_dynasty"));
  });

  test("a single board draws only its own market's columns", () => {
    const redraft = adpSortColumns(false, "redraft");
    assert.ok(redraft.includes("adp_redraft"));
    assert.ok(redraft.includes("value_redraft"));
    assert.ok(redraft.includes("auction_redraft"));
    assert.ok(!redraft.includes("adp_dynasty"));
    assert.ok(!redraft.includes("value_dynasty"));
    assert.ok(!redraft.includes("auction_dynasty"));
  });

  test("a market's Bid sort survives the other board being toggled on", () => {
    // The point of qualifying the column by board rather than by which one is
    // lit: the reader ordered by redraft bids, and widening the board to both
    // markets must not throw that away.
    const sort: AdpSort = { column: "auction_redraft", direction: "desc" };
    assert.equal(resolveAdpSort(sort, false, "redraft"), sort);
    assert.equal(resolveAdpSort(sort, true, "redraft"), sort);
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
    const sort: AdpSort = { column: "name", direction: "desc" };
    assert.equal(resolveAdpSort(sort, true, "redraft"), sort);
    assert.equal(resolveAdpSort(sort, false, "dynasty"), sort);
  });
});

describe("picks and players sort together", () => {
  test("an ADP sort interleaves them, because a pick reads a player's average", () => {
    // The whole reason a pick is a row in this list rather than a table beside
    // it: its number is the rung's, out of the same drafts, so the column
    // compares like with like.
    const rows = entries([
      player("a", { redraft: stats(5) }),
      pick("1", { redraft: pickStats(12) }),
      player("b", { redraft: stats(30) }),
    ]);
    assert.deepEqual(sortBy(rows, "adp_redraft", "asc"), ["a", "2026 1.01", "b"]);
  });

  test("a pick past the class the board priced sinks like any other blank", () => {
    const rows = entries([
      pick("1", { redraft: null }),
      player("a", { redraft: stats(30) }),
    ]);
    assert.deepEqual(sortBy(rows, "adp_redraft", "asc"), ["a", "2026 1.01"]);
    assert.deepEqual(sortBy(rows, "adp_redraft", "desc"), ["a", "2026 1.01"]);
  });
});
