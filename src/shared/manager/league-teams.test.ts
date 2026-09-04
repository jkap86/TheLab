import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { leagueTeamName, solveLeagueEntry } from "./league-teams.ts";
import type { LineupLeagueRow } from "./league-teams.ts";
import type { LeagueRosterRow } from "./league-ranks.ts";
import type { RosProjections } from "../projections/ros.ts";
import type { AdpEntry } from "./adp-value.ts";

// Annotated at the wider of LineupLeagueRow's two rosters widths — a bare
// literal trips the excess-property check against the intersection.
const ROSTERS: LeagueRosterRow[] = [
  { roster_id: 1, owner_id: "me", players: ["w1"] },
  { roster_id: 2, owner_id: "t2", players: ["w2"] },
];

/** A one-starter, two-roster league — enough to see every composed field. */
function row(overrides: Partial<LineupLeagueRow> = {}): LineupLeagueRow {
  return {
    league_id: "L1",
    total_rosters: 2,
    roster_positions: ["FLEX", "BN"],
    scoring_settings: { rec: 1 },
    rosters: ROSTERS,
    league_type: 1,
    draft_rounds: null,
    previous_league_id: "prev",
    traded_picks: [],
    drafts: [],
    users: [
      { user_id: "me", display_name: "Me", team_name: "Glass Cannons" },
      { user_id: "t2", display_name: "Slim", team_name: null },
    ],
    ...overrides,
  };
}

const PROJECTIONS: RosProjections = {
  w1: { player_id: "w1", stats: { rec: 20 }, weeks: [1], name: "W One", positions: ["WR"] },
  w2: { player_id: "w2", stats: { rec: 10 }, weeks: [1], name: "W Two", positions: ["WR"] },
};

const NO_ADP = new Map<string, AdpEntry>();

describe("leagueTeamName", () => {
  const users = row().users;

  test("the team's own name wins, the display name backs it up", () => {
    assert.equal(leagueTeamName(users, 1, "me"), "Glass Cannons");
    assert.equal(leagueTeamName(users, 2, "t2"), "Slim");
  });

  test("blank names fold in with null at every step", () => {
    const blank = [{ user_id: "u", display_name: "  ", team_name: "" }];
    assert.equal(leagueTeamName(blank, 4, "u"), "Roster 4");
  });

  test("an orphan roster and an unsynced member both read by number", () => {
    assert.equal(leagueTeamName(users, 3, null), "Roster 3");
    assert.equal(leagueTeamName(users, 5, "stranger"), "Roster 5");
  });
});

describe("solveLeagueEntry", () => {
  test("every team ships solved, labelled, and flagged for the manager", () => {
    const entry = solveLeagueEntry(row(), "me", "2026", PROJECTIONS, NO_ADP);
    assert.ok(entry);

    assert.deepEqual(
      entry.teams.map((t) => [t.roster_id, t.name, t.is_manager]),
      [
        [1, "Glass Cannons", true],
        [2, "Slim", false],
      ],
    );
    // Each team's lineup is its own solve, totals off that same solve…
    assert.equal(entry.teams[1]?.lineup.starters[0]?.player?.player_id, "w2");
    assert.equal(entry.teams[1]?.totals.ros_starters, 10);
    // …and the ranks are the manager's, as before.
    assert.deepEqual(entry.ranks.ros_starters, { rank: 1, of: 2 });
  });

  test("each team carries its own pick portfolio; owning none reads as empty", () => {
    // Roster 2's 2027 first now belongs to roster 1.
    const league = row({
      traded_picks: [{ season: "2027", round: 1, roster_id: 2, owner_id: 1 }],
    });
    const entry = solveLeagueEntry(league, "me", "2026", PROJECTIONS, NO_ADP);
    assert.ok(entry);

    // "from" names the person (display name), not their team — see LeagueUserName.
    assert.deepEqual(entry.teams[0]?.picks, [
      { season: "2027", round: 1, slot: null, from: null },
      { season: "2027", round: 1, slot: null, from: "Slim" },
    ]);
    assert.deepEqual(entry.teams[1]?.picks, []);
  });

  test("a league without the manager's roster composes to null", () => {
    assert.equal(
      solveLeagueEntry(row(), "nobody", "2026", PROJECTIONS, NO_ADP),
      null,
    );
  });
});
