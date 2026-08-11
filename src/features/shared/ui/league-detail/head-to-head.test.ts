import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { headToHead } from "./head-to-head.ts";

const teams = [{ roster_id: 1 }, { roster_id: 2 }, { roster_id: 3 }];

describe("head-to-head pair", () => {
  test("resolves the reader's roster and the one it plays, in that order", () => {
    const pair = headToHead(teams, 3, 1);
    assert.equal(pair?.mine.roster_id, 3);
    assert.equal(pair?.theirs.roster_id, 1);
  });

  test("no opponent is no pair — a bye draws the league instead", () => {
    // The lineup checker passes its own roster on a bye and nothing on the other
    // side, which is a real answer rather than a missing one.
    assert.equal(headToHead(teams, 1, undefined), null);
  });

  test("no week is no pair, which is every panel that isn't a lineup check", () => {
    assert.equal(headToHead(teams, undefined, undefined), null);
  });

  test("a roster the league no longer holds is no pair", () => {
    // The matchup and the league detail are two reads: a roster can leave
    // between them, and half a pair would put an empty half on screen.
    assert.equal(headToHead(teams, 1, 9), null);
    assert.equal(headToHead(teams, 9, 1), null);
  });

  test("a roster scheduled against itself is no pair", () => {
    // Not a hypothetical worth drawing: it would be the same lineup twice with
    // a `vs` between the halves.
    assert.equal(headToHead(teams, 2, 2), null);
  });
});
