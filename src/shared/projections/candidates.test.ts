import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isProjectable,
  lineupCandidates,
  rosterPlayerIds,
} from "./candidates.ts";
import type { CandidateRoster } from "./candidates.ts";

const roster = (team: Partial<CandidateRoster>): CandidateRoster => ({
  players: [],
  ...team,
});

describe("lineupCandidates", () => {
  it("scores each rostered player with the supplied function", () => {
    const candidates = lineupCandidates(
      roster({ players: ["a", "b"] }),
      { a: ["RB"], b: ["WR", "TE"] },
      (id) => (id === "a" ? 12.5 : 8),
    );

    assert.deepEqual(candidates, [
      { player_id: "a", positions: ["RB"], points: 12.5 },
      { player_id: "b", positions: ["WR", "TE"], points: 8 },
    ]);
  });

  /**
   * IR and taxi players sit in `players` alongside the active roster, and they
   * are candidates like anyone else: this tool ranks a stashed player as bench
   * depth that could be started rather than dropping it as unavailable (a
   * deliberate choice — Sleeper needs a roster move to seat one).
   */
  it("offers stashed players as candidates like any other", () => {
    const candidates = lineupCandidates(
      roster({ players: ["starter", "hurt", "rookie"] }),
      { starter: ["QB"], hurt: ["RB"], rookie: ["WR"] },
      () => 10,
    );

    assert.deepEqual(
      candidates.map((c) => c.player_id),
      ["starter", "hurt", "rookie"],
    );
  });

  it("drops the empty ids Sleeper pads a roster with", () => {
    const candidates = lineupCandidates(
      roster({ players: ["a", "", "b"] }),
      {},
      () => 0,
    );

    assert.deepEqual(
      candidates.map((c) => c.player_id),
      ["a", "b"],
    );
  });

  /**
   * Eligible for nothing rather than for everything: `optimalLineup` seats a
   * player only in a slot his positions allow, so an empty list keeps an unknown
   * player on the bench instead of letting him fill a slot at random.
   */
  it("gives a player the cache doesn't know no positions", () => {
    const [candidate] = lineupCandidates(
      roster({ players: ["ghost"] }),
      {},
      () => 5,
    );

    assert.deepEqual(candidate.positions, []);
  });
});

describe("rosterPlayerIds", () => {
  it("unions the rosters and deduplicates across them", () => {
    const ids = rosterPlayerIds([
      { players: ["a", "b"] },
      { players: ["b", "c"] },
    ]);

    assert.deepEqual([...ids].sort(), ["a", "b", "c"]);
  });

  it("drops empty ids", () => {
    assert.deepEqual(rosterPlayerIds([{ players: ["", "a", ""] }]), ["a"]);
  });
});

describe("isProjectable", () => {
  const league = {
    rosterPositions: ["QB", "RB"],
    scoringSettings: { pass_yd: 0.04 },
    teams: [{ roster_id: 1 }],
  };

  it("accepts a league with slots, scoring and teams", () => {
    assert.equal(isProjectable(league), true);
  });

  /**
   * Scoring a league with no settings is a dot product against nothing, which
   * comes back all zeroes and reads as a roster of worthless players rather than
   * as a league that can't be answered for.
   */
  it("refuses a league with no scoring settings", () => {
    assert.equal(isProjectable({ ...league, scoringSettings: null }), false);
  });

  it("refuses a league with no slots to solve", () => {
    assert.equal(isProjectable({ ...league, rosterPositions: null }), false);
    assert.equal(isProjectable({ ...league, rosterPositions: [] }), false);
  });

  it("refuses a league whose rosters aren't cached yet", () => {
    assert.equal(isProjectable({ ...league, teams: [] }), false);
  });
});
