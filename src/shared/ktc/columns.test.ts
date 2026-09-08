import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  adpBoardsOf,
  isAdpMetric,
  isKtcMetric,
  ktcVariantsOf,
  lineupColumnKey,
  MAX_TEAM_TOTAL_KEYS,
  normalizeLineupPositions,
  parseAdpBoards,
  parseKtcVariants,
  normalizeLineupSlots,
  parsePositionSets,
  parseSlotSets,
  parseTeamTotalKeys,
  positionSetsOf,
  qbBoardKeySuffix,
  readsQbBoard,
  serializeAdpBoards,
  serializeKtcVariants,
  serializePositionSets,
  serializeSlotSets,
  serializeTeamTotalKeys,
  slotKeySuffix,
  slotSetsOf,
} from "./columns.ts";

/**
 * How a column is named, which is the one thing the client and the server have
 * to agree on letter for letter.
 *
 * Every rule here is silent when it goes wrong. A key spelled two ways is a
 * rank the card cannot find, so the tile reads an em dash over a league that
 * was ranked; a key spelled the *same* two ways for two different pricings is
 * worse — a dynasty superflex figure printed under a 1QB label, with nothing on
 * screen saying so.
 */

type Col = Parameters<typeof lineupColumnKey>[0];

const col = (
  metric: Col["metric"],
  format: "auto" | "dynasty" | "redraft" = "auto",
  lineup: "auto" | "oneqb" | "sf" = "auto",
  positions: Col["positions"] = [],
  slots: Col["slots"] = [],
): Col => ({ metric, format, lineup, positions, slots });

describe("what prices a metric", () => {
  test("a market is KeepTradeCut's alone", () => {
    assert.equal(isKtcMetric("ktc_total"), true);
    assert.equal(isKtcMetric("ktc_picks"), true);
    assert.equal(isKtcMetric("ros_starters"), false);
    assert.equal(isKtcMetric("capital_total"), false);
  });

  test("an ADP board is the three capital metrics'", () => {
    assert.equal(isAdpMetric("capital_total"), true);
    assert.equal(isAdpMetric("capital_starters"), true);
    assert.equal(isAdpMetric("ktc_total"), false);
    assert.equal(isAdpMetric("ros_total"), false);
  });

  test("and a QB board is read by both valuations, by no projection", () => {
    // The question the picker asks to decide whether to draw the QB track: both
    // priced valuations split on how a league starts quarterbacks — KTC prices
    // every entry twice and the ADP fold aggregates superflex drafts apart —
    // where points are scored under the league's own scoring and no board
    // enters them.
    assert.equal(readsQbBoard("ktc_bench"), true);
    assert.equal(readsQbBoard("capital_bench"), true);
    assert.equal(readsQbBoard("ros_total"), false);
    assert.equal(readsQbBoard("ros_starters"), false);
  });
});

describe("lineupColumnKey", () => {
  test("a column on both autos is keyed by its bare metric id", () => {
    // Which is what lets the ten base ranks answer it without the client
    // knowing what the server resolved.
    assert.equal(lineupColumnKey(col("ktc_total")), "ktc_total");
  });

  test("a forced axis takes the whole triple", () => {
    assert.equal(
      lineupColumnKey(col("ktc_total", "dynasty", "sf")),
      "ktc_total:dynasty:sf",
    );
    assert.equal(
      lineupColumnKey(col("ktc_picks", "auto", "oneqb")),
      "ktc_picks:auto:oneqb",
    );
  });

  test("two boards on one metric are two keys", () => {
    assert.notEqual(
      lineupColumnKey(col("ktc_total", "dynasty", "sf")),
      lineupColumnKey(col("ktc_total", "dynasty", "oneqb")),
    );
  });

  test("a projection ignores both axes", () => {
    // A projection is not priced on a board at all, so a stray axis on one must
    // not become a second, indistinguishable copy of the same column.
    assert.equal(
      lineupColumnKey(col("ros_starters", "dynasty", "sf")),
      "ros_starters",
    );
    assert.equal(lineupColumnKey(col("ros_total", "auto", "sf")), "ros_total");
  });

  test("a capital column takes the QB board alone, and ignores the market", () => {
    // There is no ADP market — nobody publishes a second one — but the fold
    // does split superflex drafts from standard ones, so the QB board names a
    // second reading and the market half must fold away or `capital_total` on
    // `dynasty:sf` and on `redraft:sf` would be two keys for one pricing.
    assert.equal(lineupColumnKey(col("capital_total")), "capital_total");
    assert.equal(
      lineupColumnKey(col("capital_total", "auto", "sf")),
      "capital_total:sf",
    );
    assert.equal(
      lineupColumnKey(col("capital_total", "dynasty", "sf")),
      lineupColumnKey(col("capital_total", "redraft", "sf")),
    );
  });

  test("two ADP boards on one capital metric are two keys", () => {
    assert.notEqual(
      lineupColumnKey(col("capital_bench", "auto", "sf")),
      lineupColumnKey(col("capital_bench", "auto", "oneqb")),
    );
  });

  test("the suffix the server composes is the one the key carries", () => {
    // Two entry points to one spelling, and not even the separator repeated:
    // the route files a rank under a base metric key plus this.
    assert.equal(qbBoardKeySuffix("auto"), "");
    assert.equal(
      `capital_total${qbBoardKeySuffix("sf")}`,
      lineupColumnKey(col("capital_total", "auto", "sf")),
    );
  });
});

describe("adpBoardsOf", () => {
  test("the distinct forced boards, with `auto` dropped", () => {
    // `auto` is dropped because the base ranks answer it, which is what keeps a
    // reader who never touches this axis on the request they had.
    assert.deepEqual(
      adpBoardsOf([
        col("capital_total"),
        col("capital_bench", "auto", "sf"),
        col("capital_starters", "auto", "sf"),
        col("capital_total", "auto", "oneqb"),
      ]),
      ["sf", "oneqb"],
    );
  });

  test("a KeepTradeCut or projection column names none", () => {
    // A KTC column's board rides `ktcVariantsOf`, where it travels with its
    // market; sending it here as well would price an ADP aggregate nobody reads.
    assert.deepEqual(
      adpBoardsOf([col("ktc_total", "dynasty", "sf"), col("ros_total")]),
      [],
    );
  });
});

describe("parseAdpBoards", () => {
  test("round-trips what the columns needed", () => {
    const boards = adpBoardsOf([
      col("capital_total", "auto", "sf"),
      col("capital_bench", "auto", "oneqb"),
    ]);
    assert.deepEqual(parseAdpBoards(serializeAdpBoards(boards)), boards);
  });

  test("an unreadable token costs its column a board and nothing else", () => {
    // The degradation `?ktc_boards=` already has, and the opposite call from
    // `?season=` for the opposite reason.
    assert.deepEqual(parseAdpBoards("sf,garbage,auto"), ["sf"]);
    assert.deepEqual(parseAdpBoards("garbage"), []);
    assert.deepEqual(parseAdpBoards(null), []);
  });
});

describe("ktcVariantsOf", () => {
  test("drops the auto pricing the base ranks already answer", () => {
    assert.deepEqual(ktcVariantsOf([col("ktc_total"), col("ros_bench")]), []);
  });

  test("dedupes two columns that force the same board", () => {
    assert.deepEqual(
      ktcVariantsOf([
        col("ktc_total", "dynasty", "sf"),
        col("ktc_picks", "dynasty", "sf"),
      ]),
      [{ format: "dynasty", lineup: "sf" }],
    );
  });

  test("a forced axis on a metric with no market is not a variant", () => {
    // Otherwise a stored value carrying a stray board on a ROS column would
    // cost a market read, and a round trip, for a number nothing prices.
    assert.deepEqual(ktcVariantsOf([col("capital_total", "redraft", "sf")]), []);
  });
});

describe("parseKtcVariants", () => {
  test("round-trips what the hook serialized", () => {
    const variants = ktcVariantsOf([
      col("ktc_total", "dynasty", "sf"),
      col("ktc_bench", "redraft", "auto"),
    ]);
    assert.deepEqual(parseKtcVariants(serializeKtcVariants(variants)), variants);
  });

  test("an unreadable half folds to auto rather than failing", () => {
    assert.deepEqual(parseKtcVariants("nonsense:sf"), [
      { format: "auto", lineup: "sf" },
    ]);
  });

  test("a wholly unreadable token is dropped, not kept as auto:auto", () => {
    // `auto:auto` is the base pricing; keeping it would rank the same nine
    // metrics a second time under a second set of keys.
    assert.deepEqual(parseKtcVariants("garbage"), []);
    assert.deepEqual(parseKtcVariants(""), []);
    assert.deepEqual(parseKtcVariants(null), []);
  });
});

describe("the position axis in the key", () => {
  test("an un-narrowed column keys exactly as it always did", () => {
    // The load-bearing one: the ten base ranks the route always ships are
    // filed under bare metric ids, so an `all` token appended to every key
    // would rename every one of them and leave a card looking up a rank the
    // server computed under another name.
    assert.equal(lineupColumnKey(col("ros_starters")), "ros_starters");
    assert.equal(lineupColumnKey(col("ktc_total")), "ktc_total");
    assert.equal(
      lineupColumnKey(col("ktc_total", "dynasty", "sf")),
      "ktc_total:dynasty:sf",
    );
  });

  test("a narrowed column takes a suffix, after any forced pricing", () => {
    assert.equal(
      lineupColumnKey(col("ros_starters", "auto", "auto", ["QB", "TE"])),
      "ros_starters:qb+te",
    );
    assert.equal(
      lineupColumnKey(col("ktc_total", "dynasty", "sf", ["QB"])),
      "ktc_total:dynasty:sf:qb",
    );
  });

  test("a forced ADP board and a narrowing compose without colliding", () => {
    // The two vocabularies share a `:` and are disjoint — no position is
    // spelled `sf` or `oneqb` — so a key is read as an opaque lookup rather
    // than parsed back.
    assert.equal(
      lineupColumnKey(col("capital_total", "auto", "sf", ["QB"])),
      "capital_total:sf:qb",
    );
    assert.notEqual(
      lineupColumnKey(col("capital_total", "auto", "sf")),
      lineupColumnKey(col("capital_total", "auto", "auto", ["QB"])),
    );
  });

  test("two narrowings of one metric are two columns", () => {
    // Without the axis in the key they would dedupe into one, and the rank
    // shown under one narrowing would be the other's.
    assert.notEqual(
      lineupColumnKey(col("capital_total", "auto", "auto", ["QB"])),
      lineupColumnKey(col("capital_total", "auto", "auto", ["RB"])),
    );
  });
});

describe("normalizeLineupPositions", () => {
  test("unknown entries drop and duplicates collapse", () => {
    assert.deepEqual(
      normalizeLineupPositions(["QB", "qb", "PUNTER", 3, null]),
      ["QB"],
    );
    assert.deepEqual(normalizeLineupPositions("QB"), []);
  });

  test("the set sorts into the solver's own order, never press order", () => {
    // A reader who pressed TE then QB and one who pressed them the other way
    // are asking one question — two keys for it would be two columns of the
    // same numbers, which a four-bay rack could hold at once.
    assert.deepEqual(normalizeLineupPositions(["TE", "QB"]), ["QB", "TE"]);
    assert.deepEqual(
      normalizeLineupPositions(["DB", "WR", "DL"]),
      ["WR", "DL", "DB"],
    );
  });
});

describe("positionSetsOf", () => {
  test("the distinct narrowings, with the un-narrowed ones dropped", () => {
    // The empty set is dropped because the base ranks are its answer, which is
    // what keeps a reader who never touches this axis on the request they had.
    assert.deepEqual(
      positionSetsOf([
        col("ros_starters"),
        col("ros_bench", "auto", "auto", ["QB"]),
        col("capital_total", "auto", "auto", ["QB"]),
        col("capital_bench", "auto", "auto", ["RB", "WR"]),
      ]),
      [["QB"], ["RB", "WR"]],
    );
  });
});

describe("parsePositionSets", () => {
  test("round-trips what the columns needed", () => {
    const sets = positionSetsOf([
      col("ros_bench", "auto", "auto", ["QB"]),
      col("capital_bench", "auto", "auto", ["RB", "WR"]),
    ]);
    assert.deepEqual(parsePositionSets(serializePositionSets(sets)), sets);
  });

  test("a set that folds to empty is dropped rather than ranked", () => {
    // A garbled parameter costs the columns that named it their narrowing and
    // nothing else — the base ranks still answer them.
    assert.deepEqual(parsePositionSets("nonsense,qb"), [["QB"]]);
    assert.deepEqual(parsePositionSets("nonsense"), []);
    assert.deepEqual(parsePositionSets(null), []);
  });
});

describe("the slot clause in a key", () => {
  test("an un-narrowed column keys exactly as it always did", () => {
    // The whole reason the axis is a suffix rather than a segment: the ten base
    // ranks are filed under bare metric ids, and an `@all` token on every key
    // would rename every one of them.
    assert.equal(lineupColumnKey(col("ros_starters")), "ros_starters");
    assert.equal(slotKeySuffix([]), "");
  });

  test("the `@` is what keeps it apart from the position clause", () => {
    // Both clauses are `+`-joined lower-cased sets after a `:`, so without the
    // prefix a column counting the seats and one counting the players would be
    // one string — a rank filed under one question, read back as the other.
    const seats = lineupColumnKey(col("ros_starters", "auto", "auto", [], ["WR"]));
    const players = lineupColumnKey(col("ros_starters", "auto", "auto", ["WR"]));
    assert.equal(seats, "ros_starters:@wr");
    assert.equal(players, "ros_starters:wr");
    assert.notEqual(seats, players);
  });

  test("the seats come before the players, and the pricing before both", () => {
    assert.equal(
      lineupColumnKey(
        col("ros_starters", "auto", "auto", ["WR"], ["FLEX", "SUPER_FLEX"]),
      ),
      "ros_starters:@flex+super_flex:wr",
    );
    assert.equal(
      lineupColumnKey(col("capital_starters", "auto", "sf", [], ["FLEX"])),
      "capital_starters:sf:@flex",
    );
    assert.equal(
      lineupColumnKey(col("ktc_starters", "dynasty", "sf", ["QB"], ["SUPER_FLEX"])),
      "ktc_starters:dynasty:sf:@super_flex:qb",
    );
  });

  test("two seat sets are two columns", () => {
    // Which is the whole reason the clause is in the key: without it the two
    // dedupe into one, and the rank shown under one narrowing is the other's.
    assert.notEqual(
      lineupColumnKey(col("ros_starters", "auto", "auto", [], ["FLEX"])),
      lineupColumnKey(col("ros_starters", "auto", "auto", [], ["SUPER_FLEX"])),
    );
  });

  test("the order is taken as given, never sorted here", () => {
    // `positionKeySuffix`' rule one clause over, and worth pinning because it
    // looks like an omission: two press orders are made one identity by
    // `normalizeLineupSlots` inside `column()`, which is the single constructor
    // every stored and pressed value goes through. Sorting again here would be
    // a second answer to that, and one a hand-built literal could disagree
    // with silently.
    assert.equal(
      lineupColumnKey(
        col("ros_starters", "auto", "auto", [], ["SUPER_FLEX", "FLEX"]),
      ),
      "ros_starters:@super_flex+flex",
    );
    assert.deepEqual(normalizeLineupSlots(["SUPER_FLEX", "FLEX"]), [
      "FLEX",
      "SUPER_FLEX",
    ]);
  });
});

describe("normalizeLineupSlots", () => {
  test("sorts into the vocabulary's own order, whatever the press order", () => {
    assert.deepEqual(normalizeLineupSlots(["SUPER_FLEX", "QB", "FLEX"]), [
      "QB",
      "FLEX",
      "SUPER_FLEX",
    ]);
  });

  test("upper-cases, dedupes, and drops what no lineup can seat", () => {
    assert.deepEqual(normalizeLineupSlots(["flex", "FLEX", "BN", "OP", 7]), [
      "FLEX",
    ]);
    assert.deepEqual(normalizeLineupSlots("FLEX"), []);
    assert.deepEqual(normalizeLineupSlots(undefined), []);
  });

  test("keeps a seat the reader's leagues no longer start", () => {
    // The vocabulary here is the whole table, deliberately wider than the track
    // that writes it: a stored `@dl` is still a good question about the leagues
    // it was asked of, and dropping it would silently widen that column to the
    // whole lineup.
    assert.deepEqual(normalizeLineupSlots(["DL"]), ["DL"]);
  });
});

describe("slotSetsOf", () => {
  test("names the distinct sets and drops the empty one", () => {
    // Sets and not columns, on `positionSetsOf`' terms: the base ranks answer
    // the un-narrowed column, so a reader who never touches the axis is on
    // exactly the request they had.
    assert.deepEqual(
      slotSetsOf([
        col("ros_starters"),
        col("ros_starters", "auto", "auto", [], ["FLEX"]),
        col("capital_starters", "auto", "sf", [], ["FLEX"]),
        col("ktc_starters", "auto", "auto", [], ["FLEX", "SUPER_FLEX"]),
      ]),
      [["FLEX"], ["FLEX", "SUPER_FLEX"]],
    );
  });
});

describe("parseSlotSets", () => {
  test("round-trips what the columns needed, with no `@` on the wire", () => {
    // The prefix keeps two clauses apart inside one key; a parameter named
    // `slots` has nothing to be told apart from.
    const sets = slotSetsOf([
      col("ros_starters", "auto", "auto", [], ["FLEX", "SUPER_FLEX"]),
      col("capital_starters", "auto", "auto", [], ["QB"]),
    ]);
    assert.equal(serializeSlotSets(sets), "flex+super_flex,qb");
    assert.deepEqual(parseSlotSets(serializeSlotSets(sets)), sets);
  });

  test("a set that folds to empty is dropped rather than ranked", () => {
    assert.deepEqual(parseSlotSets("nonsense,flex"), [["FLEX"]]);
    assert.deepEqual(parseSlotSets("nonsense"), []);
    assert.deepEqual(parseSlotSets(null), []);
  });
});

/**
 * The list of column keys a caller names a per-roster total for.
 *
 * Every rule in it is about a string nothing here understands — a key is
 * composed at both ends and matched by equality — so what is tested is the
 * shape of the guard rather than the meaning of a token.
 */
describe("parseTeamTotalKeys", () => {
  test("reads a comma list back", () => {
    assert.deepEqual(parseTeamTotalKeys("ros_starters,ktc_total:dynasty:sf"), [
      "ros_starters",
      "ktc_total:dynasty:sf",
    ]);
  });

  test("round-trips whatever `lineupColumnKey` writes", () => {
    const key = lineupColumnKey({
      metric: "ktc_starters",
      format: "dynasty",
      lineup: "sf",
      positions: ["WR", "TE"],
      slots: ["FLEX", "SUPER_FLEX"],
    });
    assert.deepEqual(parseTeamTotalKeys(serializeTeamTotalKeys([key])), [key]);
  });

  test("absent and empty are no keys at all", () => {
    assert.deepEqual(parseTeamTotalKeys(null), []);
    assert.deepEqual(parseTeamTotalKeys(""), []);
  });

  test("dedupes, so a repeated key is not carried twice", () => {
    assert.deepEqual(parseTeamTotalKeys("ros_bench,ros_bench"), ["ros_bench"]);
  });

  test("drops a token that is not shaped like a key", () => {
    // Upper case, spaces, a slash, a wildcard: none of them can occur in a key
    // `lineupColumnKey` writes, and each is what a hand-typed query looks like.
    assert.deepEqual(parseTeamTotalKeys("ros_bench,ROS_BENCH,a b,x/y,*"), [
      "ros_bench",
    ]);
  });

  test("drops a token too long to be a key", () => {
    assert.deepEqual(parseTeamTotalKeys(`ros_bench,${"a".repeat(201)}`), [
      "ros_bench",
    ]);
  });

  /**
   * The bound is the point: a key is matched rather than validated, so nothing
   * else here can refuse a query asking for a thousand keyed sums over every
   * roster of a hundred leagues.
   */
  test("stops at the cap", () => {
    const asked = ["a", "b", "c", "d", "e", "f"].join(",");
    assert.equal(parseTeamTotalKeys(asked).length, MAX_TEAM_TOTAL_KEYS);
  });
});
