import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { matchupState, opponentLabel } from "./opponent.ts";
import type {
  LeagueMatchupPayload,
  MatchupOpponentPayload,
} from "./types.ts";

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

/**
 * A stored matchup with only the field this module reads filled in — the
 * projections ride on the same payload and `matchupState` is deliberately blind
 * to them: which of the four states a row is in is a question about the pairing.
 */
const matchup = (
  opponent: MatchupOpponentPayload | null,
): LeagueMatchupPayload => ({
  roster_id: 1,
  opponent,
  projection: null,
  opponent_projection: null,
  median_projection: null,
});

describe("matchupState", () => {
  test("no stored week is a fact about the season, whatever a league holds", () => {
    assert.deepEqual(matchupState(null, matchup(opponent())), {
      kind: "no-week",
    });
  });

  test("a league absent from the read is unsynced, not a bye", () => {
    assert.deepEqual(matchupState(3, undefined), { kind: "unsynced" });
  });

  test("stored with no opponent is a bye — a real answer", () => {
    assert.deepEqual(matchupState(3, matchup(null)), {
      kind: "bye",
    });
  });

  test("carries the opponent through where there is one", () => {
    const other = opponent();
    assert.deepEqual(matchupState(3, matchup(other)), {
      kind: "opponent",
      opponent: other,
    });
  });
});
