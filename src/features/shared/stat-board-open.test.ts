import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseStatBoardOpen } from "./stat-board-open.ts";

describe("parseStatBoardOpen", () => {
  test("only the literal this writes reads as open", () => {
    // Anything else is the default, so a hand-edited or stale key cannot put a
    // full-height table over the page on a first paint.
    assert.equal(parseStatBoardOpen("1"), true);
    assert.equal(parseStatBoardOpen("0"), false);
    assert.equal(parseStatBoardOpen(null), false);
    assert.equal(parseStatBoardOpen("true"), false);
    assert.equal(parseStatBoardOpen(""), false);
  });
});
