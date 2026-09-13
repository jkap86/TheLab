import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  parseSharesConsoleOpen,
  parseSharesTab,
} from "./shares-console-open.ts";

describe("parseSharesConsoleOpen", () => {
  test("only the literal this writes reads as open", () => {
    // Anything else is the default, so a hand-edited or stale key cannot put a
    // panel over most of the league grid on a first paint.
    assert.equal(parseSharesConsoleOpen("1"), true);
    assert.equal(parseSharesConsoleOpen("0"), false);
    assert.equal(parseSharesConsoleOpen(null), false);
    assert.equal(parseSharesConsoleOpen("true"), false);
    assert.equal(parseSharesConsoleOpen(""), false);
  });
});

describe("parseSharesTab", () => {
  test("only the literal this writes reads as leaguemates", () => {
    assert.equal(parseSharesTab("leaguemate"), "leaguemate");
    assert.equal(parseSharesTab("player"), "player");
  });

  test("anything else is the players list", () => {
    // A stale or hand-edited key falls to the tab a reader most often wants
    // rather than to an empty one — see the module note.
    assert.equal(parseSharesTab(null), "player");
    assert.equal(parseSharesTab(""), "player");
    assert.equal(parseSharesTab("mates"), "player");
    assert.equal(parseSharesTab("Leaguemate"), "player");
  });
});
