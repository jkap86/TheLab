import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_KTC_BOARD,
  KTC_BOARD_CHOICES,
  parseKtcBoardChoice,
  resolveKtcFormat,
} from "./board-choice.ts";

/**
 * One rule, four readers — two routes and two pages — so what is pinned here is
 * the part that would be silent if the four ever disagreed: which market a
 * league lands on, and that an unreadable answer is the neutral one rather than
 * a market.
 */

describe("parseKtcBoardChoice", () => {
  test("accepts every choice the control offers", () => {
    for (const choice of KTC_BOARD_CHOICES) {
      assert.equal(parseKtcBoardChoice(choice), choice);
    }
  });

  test("folds anything else to the default rather than failing", () => {
    for (const bad of ["", "DYNASTY", "ppr", null, undefined, 2, {}, ["auto"]]) {
      assert.equal(
        parseKtcBoardChoice(bad),
        DEFAULT_KTC_BOARD,
        `expected the default for ${JSON.stringify(bad)}`,
      );
    }
  });

  test("the default is the rule, not either market", () => {
    assert.equal(DEFAULT_KTC_BOARD, "auto");
  });
});

describe("resolveKtcFormat", () => {
  test("auto sends a dynasty league to the dynasty board", () => {
    assert.equal(resolveKtcFormat("auto", 2), "dynasty");
  });

  // Keeper is the arguable one and it falls to redraft on purpose — see the
  // module note. Chopped and redraft follow it, and so does an unknown type.
  test("auto sends everything else to the redraft board", () => {
    for (const type of [0, 1, 3, 9, null]) {
      assert.equal(
        resolveKtcFormat("auto", type),
        "redraft",
        `expected redraft for type ${String(type)}`,
      );
    }
  });

  test("a forcing choice ignores the league's type entirely", () => {
    for (const type of [0, 1, 2, 3, null]) {
      assert.equal(resolveKtcFormat("dynasty", type), "dynasty");
      assert.equal(resolveKtcFormat("redraft", type), "redraft");
    }
  });
});
