import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_START_SIT_SORT,
  nextStartSitSort,
  sortStartSit,
  startSitAscending,
  type StartSitSortable,
} from "./start-sit-sort.ts";

function row(
  name: string,
  over: Partial<StartSitSortable> = {},
): StartSitSortable {
  return {
    name,
    started: 0,
    benched: 0,
    oppStarted: 0,
    oppBenched: 0,
    figure: 0,
    ...over,
  };
}

const names = (rows: readonly StartSitSortable[]) => rows.map((r) => r.name);

describe("nextStartSitSort", () => {
  test("the default is the reader's own starts, most first", () => {
    assert.deepEqual(DEFAULT_START_SIT_SORT, { key: "start", ascending: false });
  });

  test("a fresh press takes the key's own direction: name A–Z, every figure most first", () => {
    assert.equal(startSitAscending("name"), true);
    assert.deepEqual(nextStartSitSort({ key: "figure", ascending: true }, "name"), {
      key: "name",
      ascending: true,
    });
    const held = { key: "name", ascending: false } as const;
    for (const key of ["start", "bench", "opp-start", "opp-bench", "figure"] as const) {
      assert.equal(startSitAscending(key), false, key);
      assert.deepEqual(nextStartSitSort(held, key), { key, ascending: false }, key);
    }
  });

  test("a press on the lit head reverses it, and a second press restores it", () => {
    const once = nextStartSitSort(DEFAULT_START_SIT_SORT, "start");
    assert.deepEqual(once, { key: "start", ascending: true });
    assert.deepEqual(nextStartSitSort(once, "start"), DEFAULT_START_SIT_SORT);
  });

  test("a new key after a reversal takes its own direction, not the held one", () => {
    const reversed = { key: "bench", ascending: true } as const;
    assert.deepEqual(nextStartSitSort(reversed, "opp-bench"), {
      key: "opp-bench",
      ascending: false,
    });
    assert.deepEqual(nextStartSitSort({ key: "name", ascending: false }, "figure"), {
      key: "figure",
      ascending: false,
    });
  });
});

describe("sortStartSit", () => {
  test("each count sorts most first, and fewest first reversed — a zero as a zero", () => {
    const fields = {
      start: "started",
      bench: "benched",
      "opp-start": "oppStarted",
      "opp-bench": "oppBenched",
    } as const;
    for (const [key, field] of Object.entries(fields) as [
      keyof typeof fields,
      (typeof fields)[keyof typeof fields],
    ][]) {
      const rows = [row("A", { [field]: 1 }), row("B", { [field]: 3 }), row("C", { [field]: 0 })];
      assert.deepEqual(names(sortStartSit(rows, { key, ascending: false })), ["B", "A", "C"], key);
      assert.deepEqual(names(sortStartSit(rows, { key, ascending: true })), ["C", "A", "B"], key);
    }
  });

  test("an absent figure sorts last in either direction", () => {
    const rows = [
      row("Ten", { figure: 10 }),
      row("Zed", { figure: null }),
      row("Three", { figure: 3 }),
      row("Abe", { figure: null }),
      row("Seven", { figure: 7 }),
    ];
    assert.deepEqual(names(sortStartSit(rows, { key: "figure", ascending: false })), [
      "Ten",
      "Seven",
      "Three",
      "Abe",
      "Zed",
    ]);
    assert.deepEqual(names(sortStartSit(rows, { key: "figure", ascending: true })), [
      "Three",
      "Seven",
      "Ten",
      "Abe",
      "Zed",
    ]);
  });

  test("ties break on the name A–Z, and the tiebreak does not reverse", () => {
    const rows = [
      row("Chase", { started: 2 }),
      row("Zed", { started: 5 }),
      row("Adams", { started: 2 }),
      row("Bijan", { started: 2 }),
    ];
    assert.deepEqual(names(sortStartSit(rows, { key: "start", ascending: false })), [
      "Zed",
      "Adams",
      "Bijan",
      "Chase",
    ]);
    assert.deepEqual(names(sortStartSit(rows, { key: "start", ascending: true })), [
      "Adams",
      "Bijan",
      "Chase",
      "Zed",
    ]);
  });

  test("the name sorts A–Z and Z–A by collation rather than by code unit", () => {
    const rows = [row("Chase"), row("adams"), row("Bijan")];
    assert.deepEqual(names(sortStartSit(rows, { key: "name", ascending: true })), [
      "adams",
      "Bijan",
      "Chase",
    ]);
    assert.deepEqual(names(sortStartSit(rows, { key: "name", ascending: false })), [
      "Chase",
      "Bijan",
      "adams",
    ]);
  });

  test("the input is left in its own order", () => {
    const rows = [row("B", { started: 1 }), row("A", { started: 2 })];
    const sorted = sortStartSit(rows, DEFAULT_START_SIT_SORT);
    assert.notEqual(sorted, rows);
    assert.deepEqual(names(rows), ["B", "A"]);
    assert.deepEqual(names(sorted), ["A", "B"]);
  });
});
