import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rankByName } from "./name-search.ts";

const NAMES = [
  "Bijan Robinson",
  "Ja'Marr Chase",
  "Chase Brown",
  "A.J. Brown",
  "Christian McCaffrey",
];

const rank = (query: string, limit = 10) =>
  rankByName(NAMES, (name) => name, query, limit);

describe("rankByName", () => {
  test("an empty query is the head of the list, in the order given", () => {
    assert.deepEqual(rank("", 2), ["Bijan Robinson", "Ja'Marr Chase"]);
    assert.deepEqual(rank("   "), NAMES);
  });

  test("a word-start match leads a mid-name one, whatever the input order", () => {
    // "Bijan" holds "ja" mid-word and comes first in the list; the name that
    // starts with it still answers first, which is the whole of the rule.
    assert.deepEqual(rank("ja"), ["Ja'Marr Chase", "Bijan Robinson"]);
  });

  test("any word start counts, so a surname is reachable on its own", () => {
    assert.equal(rank("robinson")[0], "Bijan Robinson");
  });

  test("a dot ends a word too, which is what makes an initial searchable", () => {
    assert.deepEqual(rank("j"), [
      "Ja'Marr Chase",
      "A.J. Brown",
      "Bijan Robinson",
    ]);
  });

  test("matching is case-insensitive", () => {
    assert.equal(rank("MCCAFFREY")[0], "Christian McCaffrey");
  });

  test("no match is an empty list, not the whole list", () => {
    assert.deepEqual(rank("zzzz"), []);
  });

  test("the cap is over both buckets, and a prefix takes the last slot", () => {
    assert.deepEqual(rank("ja", 1), ["Ja'Marr Chase"]);
  });
});
