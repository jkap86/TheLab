import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseStartSitConsoleOpen } from "./start-sit-console-open.ts";

describe("parseStartSitConsoleOpen", () => {
  test("only the literal this writes reads as open", () => {
    // Anything else is the default, so a hand-edited or stale key cannot put a
    // 62dvh panel over most of the league grid on a first paint.
    assert.equal(parseStartSitConsoleOpen("1"), true);
    assert.equal(parseStartSitConsoleOpen("0"), false);
    assert.equal(parseStartSitConsoleOpen(null), false);
    assert.equal(parseStartSitConsoleOpen("true"), false);
    assert.equal(parseStartSitConsoleOpen(""), false);
  });
});
