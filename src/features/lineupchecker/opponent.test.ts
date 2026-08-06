import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { matchupState, opponentLabel } from "./opponent.ts";
import type { MatchupOpponentPayload } from "./types.ts";

const opponent = (
  fields: Partial<MatchupOpponentPayload> = {},
): MatchupOpponentPayload => ({
  roster_id: 7,
  user_id: "42",
  display_name: "jkap86",
  team_name: "Team Chaos",
  avatar_url: null,
  ...fields,
});

describe("opponentLabel", () => {
  test("prefers the username, so one person reads as one person across leagues", () => {
    assert.equal(opponentLabel(opponent()), "jkap86");
  });

  test("falls back to the team name before the roster number", () => {
    assert.equal(
      opponentLabel(opponent({ display_name: null })),
      "Team Chaos",
    );
  });

  test("names the roster when nothing else identifies an orphan team", () => {
    assert.equal(
      opponentLabel(
        opponent({ user_id: null, display_name: null, team_name: null }),
      ),
      "Roster 7",
    );
  });

  test("treats an empty name as absent, not as a name", () => {
    assert.equal(opponentLabel(opponent({ display_name: "" })), "Team Chaos");
  });
});

describe("matchupState", () => {
  test("no stored week is a fact about the season, whatever a league holds", () => {
    assert.deepEqual(matchupState(null, { roster_id: 1, opponent: opponent() }), {
      kind: "no-week",
    });
  });

  test("a league absent from the read is unsynced, not a bye", () => {
    assert.deepEqual(matchupState(3, undefined), { kind: "unsynced" });
  });

  test("stored with no opponent is a bye — a real answer", () => {
    assert.deepEqual(matchupState(3, { roster_id: 1, opponent: null }), {
      kind: "bye",
    });
  });

  test("carries the opponent through where there is one", () => {
    const other = opponent();
    assert.deepEqual(matchupState(3, { roster_id: 1, opponent: other }), {
      kind: "opponent",
      opponent: other,
    });
  });
});
