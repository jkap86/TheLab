import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SHARES_COLUMNS,
  MAX_SHARES_COLUMNS,
  maxSharesColumns,
  mergeSharesColumns,
  type SharesColumnId,
  SHARES_COLUMNS_BY_KIND,
  sharesColumnBreak,
  sharesColumns,
  WEEK_READING_COLUMN,
} from "./shares-columns.ts";

/**
 * The two rules a stored column sequence is read by, and both are silent when
 * wrong: a panel showing a column it cannot fill, and a panel quietly editing
 * the other panel's choice on the way past.
 *
 * The hook and the write are not exercised here — they are `local-store`'s, and
 * that file's own contract is what they follow. What is tested is the pure half
 * either end of it shares.
 */

const ALL: SharesColumnId[] = ["value", "age", "class", "record", "share"];

describe("sharesColumns", () => {
  test("keeps the reader's order rather than a canonical one", () => {
    assert.deepEqual(sharesColumns(["share", "value"], "player"), [
      "share",
      "value",
    ]);
  });

  test("caps at the panel's bound", () => {
    const capped = sharesColumns(ALL, "player");
    assert.equal(capped.length, MAX_SHARES_COLUMNS);
    assert.deepEqual(capped, ["value", "age", "class"]);
  });

  test("drops what the panel cannot offer", () => {
    // A value, an age and a class are facts about a player; a leaguemate has
    // none of them, so the panel is left with the two it can answer.
    assert.deepEqual(sharesColumns(ALL, "leaguemate"), ["record", "share"]);
  });

  test("falls back to everything the panel offers when nothing survives", () => {
    // Not to a fixed default, and not to one column: a stored sequence naming
    // nothing this panel answers is not a preference about this panel, so the
    // honest default is what the panel is for.
    assert.deepEqual(sharesColumns(["value", "age", "class"], "leaguemate"), [
      "record",
      "share",
    ]);
  });

  test("the week panel opens on all four of its columns, not just the last", () => {
    // The case that made the single-column fallback wrong: the four are one
    // reading split four ways, and the stored default is three season metrics
    // — so *every* first visit hits this branch and would otherwise have been
    // shown a quarter of the panel it opened.
    assert.deepEqual(sharesColumns(DEFAULT_SHARES_COLUMNS, "week"), [
      "start",
      "bench",
      "opp-start",
      "opp-bench",
    ]);
  });

  test("the week panel's cap is four and every other panel's is three", () => {
    // A fact about the row's width rather than about how many metrics exist:
    // that panel is 40rem and these are 34, so one cap for both would let a
    // manager drawer offer a cell it cannot hold.
    assert.equal(maxSharesColumns("week"), 4);
    assert.equal(maxSharesColumns("player"), MAX_SHARES_COLUMNS);
    assert.equal(
      sharesColumns(["value", "age", "class", "record", "share"], "player")
        .length,
      MAX_SHARES_COLUMNS,
    );
  });

  test("the default is valid on both panels", () => {
    assert.deepEqual(
      sharesColumns(DEFAULT_SHARES_COLUMNS, "player"),
      DEFAULT_SHARES_COLUMNS,
    );
    assert.deepEqual(sharesColumns(DEFAULT_SHARES_COLUMNS, "leaguemate"), [
      "record",
      "share",
    ]);
  });
});

describe("mergeSharesColumns", () => {
  test("a player-panel write is the whole sequence", () => {
    // Every metric is offered there, so nothing is being kept out of the way.
    assert.deepEqual(
      mergeSharesColumns(["value", "record", "share"], "player", [
        "share",
        "value",
      ]),
      ["share", "value"],
    );
  });

  test("a leaguemate-panel write keeps the player metrics", () => {
    // The bug this exists to stop: storing only what the leaguemate panel shows
    // would come back to the player panel with Value, Age and Class gone, and
    // nobody edited them.
    assert.deepEqual(
      mergeSharesColumns(["value", "age", "record"], "leaguemate", ["share"]),
      ["value", "age", "share"],
    );
  });

  test("keeps the unoffered ids where they sat", () => {
    // `value` led the sequence and still does; reordering `record`/`share` on
    // the leaguemate panel must not shuffle the player panel's leading column.
    assert.deepEqual(
      mergeSharesColumns(["record", "share", "value"], "leaguemate", [
        "share",
        "record",
      ]),
      ["share", "record", "value"],
    );
    assert.deepEqual(
      mergeSharesColumns(["value", "record", "share"], "leaguemate", [
        "share",
        "record",
      ]),
      ["value", "share", "record"],
    );
  });

  test("appends when the panel had nothing stored to sit beside", () => {
    // The fallback case: `sharesColumns` showed Share without it being stored,
    // and adding Rec · Win has to leave a sequence that reads back as both.
    const merged = mergeSharesColumns(["value", "age", "class"], "leaguemate", [
      "share",
      "record",
    ]);
    assert.deepEqual(merged, ["value", "age", "class", "share", "record"]);
    assert.deepEqual(sharesColumns(merged, "leaguemate"), ["share", "record"]);
    // …and the player panel is exactly where it was left.
    assert.deepEqual(sharesColumns(merged, "player"), ["value", "age", "class"]);
  });
});

describe("sharesColumnBreak", () => {
  test("a groove is cut where the side changes and nowhere else", () => {
    // Read as a run rather than as a key: the boundary is a property of the
    // vocabulary, so the Sort track gets it without being told where it is.
    assert.equal(sharesColumnBreak("start", undefined), false);
    assert.equal(sharesColumnBreak("bench", "start"), false);
    assert.equal(sharesColumnBreak("opp-start", "bench"), true);
    assert.equal(sharesColumnBreak("opp-bench", "opp-start"), false);
  });

  test("the season metrics are one run, so they cut nothing", () => {
    assert.equal(sharesColumnBreak("age", "value"), false);
    assert.equal(sharesColumnBreak("share", "record"), false);
  });

  test("every reading names a column, and they are the same four", () => {
    // The `Record` is what ties the pure module's vocabulary to this one; the
    // assertion is that it stayed an identity map, which is the whole point of
    // spelling them alike.
    assert.deepEqual(WEEK_READING_COLUMN, {
      start: "start",
      bench: "bench",
      "opp-start": "opp-start",
      "opp-bench": "opp-bench",
    });
    assert.deepEqual(
      Object.values(WEEK_READING_COLUMN).sort(),
      [...SHARES_COLUMNS_BY_KIND.week].sort(),
    );
  });
});
