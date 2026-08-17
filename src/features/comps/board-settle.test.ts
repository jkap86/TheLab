import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildCompsQuery } from "./build-query.ts";
import {
  boardSettleDelay,
  boardSettlePending,
  COMPS_BOARD_SETTLE_MS,
  effectiveBoardKey,
} from "./board-settle.ts";
import { defaultWeightBoard, weightsFor } from "./prefs.ts";

import type { CompsBoardTarget } from "./board-settle.ts";

/**
 * **The request that must never be made: this subject, the previous position's
 * board.**
 *
 * Boards are per position, weight edits are debounced, and the subject is not —
 * so for a beat after picking a quarterback while a customized receiver board
 * was still settling, the page held a quarterback subject and a receiver board
 * and built a request out of the pair. What comes back is a real answer to a
 * question nobody asked, and it lands in its own cache entry under its own key,
 * so it is not even transient.
 *
 * The whole fix is that the effective board is *derived* from the settled one
 * and the position rather than being a second piece of state that catches up.
 * These tests drive that derivation through the sequence the bug needed, with
 * the timer represented as the delay the page is told to wait.
 */

const wr: CompsBoardTarget = { position: "WR", boardKey: "" };
const qb: CompsBoardTarget = { position: "QB", boardKey: "" };
const customWr: CompsBoardTarget = { position: "WR", boardKey: "wr-custom" };
const customWr2: CompsBoardTarget = { position: "WR", boardKey: "wr-custom-2" };

describe("an edit within one position", () => {
  test("is held back, so a drag across a slider is one request", () => {
    assert.equal(effectiveBoardKey(customWr, customWr2), "wr-custom");
    assert.equal(boardSettlePending(customWr, customWr2), true);
    assert.equal(boardSettleDelay(customWr, customWr2), COMPS_BOARD_SETTLE_MS);
  });

  test("settles into place once the delay has passed", () => {
    assert.equal(effectiveBoardKey(customWr2, customWr2), "wr-custom-2");
    assert.equal(boardSettlePending(customWr2, customWr2), false);
    assert.equal(boardSettleDelay(customWr2, customWr2), null);
  });

  test("the debounce is long enough to be one, and short enough to feel live", () => {
    assert.ok(COMPS_BOARD_SETTLE_MS >= 150);
    assert.ok(COMPS_BOARD_SETTLE_MS <= 400);
  });
});

describe("a change of subject position", () => {
  test("uses the new position's board at once, mid-debounce", () => {
    // The regression, stated as the sequence: a customized WR board is settling
    // (the reader moved a weight and the timer is still running) when a QB is
    // picked. The board the request is built from is the quarterback's from the
    // first render after the press — never the receiver's.
    const settling: CompsBoardTarget = customWr;
    const target: CompsBoardTarget = { position: "QB", boardKey: "" };
    assert.equal(effectiveBoardKey(settling, target), "");
    assert.notEqual(effectiveBoardKey(settling, target), customWr.boardKey);
  });

  test("carries a customized board for the new position, not the old one", () => {
    const settling: CompsBoardTarget = customWr;
    const target: CompsBoardTarget = { position: "QB", boardKey: "qb-custom" };
    assert.equal(effectiveBoardKey(settling, target), "qb-custom");
  });

  test("is not reported as pending — nothing is lagging", () => {
    // The "Updating…" note means "these rows answer an older comparison". After
    // a position change the rows are about to be replaced wholesale, and the
    // board they will be replaced under is already the right one.
    assert.equal(boardSettlePending(customWr, qb), false);
  });

  test("moves the baseline without waiting", () => {
    // Zero rather than null: the settled board still has to move, or the next
    // edit within the new position would be debounced against a baseline
    // belonging to the old one.
    assert.equal(boardSettleDelay(customWr, qb), 0);
    assert.equal(boardSettleDelay(wr, qb), 0);
  });

  test("edits within the new position debounce again from there", () => {
    const settled: CompsBoardTarget = { position: "QB", boardKey: "qb-1" };
    const target: CompsBoardTarget = { position: "QB", boardKey: "qb-2" };
    assert.equal(boardSettleDelay(settled, target), COMPS_BOARD_SETTLE_MS);
    assert.equal(effectiveBoardKey(settled, target), "qb-1");
  });
});

describe("the first subject", () => {
  test("lands immediately — there is no board to hold", () => {
    const nothing: CompsBoardTarget = { position: null, boardKey: "" };
    assert.equal(effectiveBoardKey(nothing, customWr), "wr-custom");
    assert.equal(boardSettleDelay(nothing, customWr), 0);
    assert.equal(boardSettlePending(nothing, customWr), false);
  });
});

describe("the query the page actually builds", () => {
  /**
   * End to end through `buildCompsQuery`, because the derivation is only worth
   * anything if the *request* comes out right — this is the assertion in the
   * terms the bug was reported in.
   */
  const query = (
    settled: CompsBoardTarget,
    target: CompsBoardTarget,
    playerId: string,
    position: "QB" | "WR",
  ): string => {
    const key = effectiveBoardKey(settled, target);
    const board = key ? (JSON.parse(key) as Record<string, number>) : null;
    return buildCompsQuery({
      playerId,
      season: null,
      basis: "per_game",
      position,
      weights: board,
    });
  };

  test("a QB picked mid-edit is compared on a QB board", () => {
    // The receiver board, tuned and still settling.
    const tuned = { ...weightsFor({ basis: "per_game", weightsByPosition: {}, windowsByPosition: {} }, "WR"), rec_tgt: 20 };
    const settling: CompsBoardTarget = {
      position: "WR",
      boardKey: JSON.stringify(tuned),
    };
    // The quarterback, untouched: no `fields=` at all, which is what shares the
    // default board's cache entry.
    const target: CompsBoardTarget = { position: "QB", boardKey: "" };
    const built = query(settling, target, "4046", "QB");
    assert.equal(built, "player_id=4046");
    assert.equal(built.includes("rec_tgt"), false);
  });

  test("a QB board the reader had tuned earlier is used as-is", () => {
    const qbBoard = { ...defaultWeightBoard("QB"), pass_yd: 20 };
    const settling: CompsBoardTarget = { position: "WR", boardKey: "{}" };
    const target: CompsBoardTarget = {
      position: "QB",
      boardKey: JSON.stringify(qbBoard),
    };
    const built = query(settling, target, "4046", "QB");
    const params = new URLSearchParams(built);
    const fields = params.get("fields")?.split(",") ?? [];
    const weights = params.get("weights")?.split(",") ?? [];
    assert.ok(fields.includes("pass_yd"));
    assert.equal(weights[fields.indexOf("pass_yd")], "20");
    // And nothing a receiver board weighs is on it.
    assert.equal(fields.includes("rec_tgt"), false);
  });
});
