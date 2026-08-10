import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  TRADE_BOARDS_KEPT,
  type TradeBoardEntry,
  retiredTradeBoards,
} from "./board-retention.ts";

const board = (
  key: string,
  updatedAt: number,
  observers = 0,
): TradeBoardEntry => ({ key, updatedAt, observers });

describe("retiredTradeBoards", () => {
  test("keeps everything while the count is inside the bound", () => {
    const boards = [board("a", 3), board("b", 2), board("c", 1)];
    assert.deepEqual(retiredTradeBoards(boards, "live", 3), []);
  });

  test("drops the least recently read past the bound", () => {
    const boards = [
      board("oldest", 10),
      board("newer", 30),
      board("newest", 40),
      board("older", 20),
    ];
    assert.deepEqual(retiredTradeBoards(boards, "live", 3), ["oldest"]);
  });

  test("never drops the board being read", () => {
    // Even before its first page has arrived, when its `updatedAt` is 0 and a
    // plain recency sort would pick it first.
    const boards = [
      board("live", 0, 1),
      board("a", 4),
      board("b", 3),
      board("c", 2),
      board("d", 1),
    ];
    const dropped = retiredTradeBoards(boards, "live", 3);
    assert.ok(!dropped.includes("live"));
    assert.deepEqual(dropped, ["d"]);
  });

  test("never drops a board something is still reading", () => {
    // A board with observers is on screen — or is the placeholder
    // `keepPreviousData` is showing while the next one lands.
    const boards = [
      board("watched", 1, 2),
      board("a", 5),
      board("b", 4),
      board("c", 3),
      board("d", 2),
    ];
    const dropped = retiredTradeBoards(boards, "live", 3);
    assert.ok(!dropped.includes("watched"));
    assert.deepEqual(dropped, ["d"]);
  });

  test("the board just left survives a switch", () => {
    // The whole point of not evicting on a filter change: widening back is a hit
    // with the scroll position intact. `previous` is the most recent of the
    // abandoned ones, so it is the last thing this would ever drop.
    const boards = [
      board("live", 0, 1),
      board("previous", 99),
      board("a", 3),
      board("b", 2),
      board("c", 1),
    ];
    assert.ok(!retiredTradeBoards(boards, "live", 1).includes("previous"));
  });

  test("a lowered bound converges rather than trimming one at a time", () => {
    const boards = Array.from({ length: 10 }, (_, i) => board(`k${i}`, i));
    assert.equal(retiredTradeBoards(boards, "live", 2).length, 8);
  });

  test("ties break deterministically", () => {
    const boards = [board("b", 5), board("a", 5), board("c", 5)];
    assert.deepEqual(retiredTradeBoards(boards, "live", 1), ["b", "c"]);
  });

  test("the default keeps more than the one that makes widening back a hit", () => {
    // Coming back two presses is as ordinary as coming back one.
    assert.ok(TRADE_BOARDS_KEPT > 1);
  });
});
