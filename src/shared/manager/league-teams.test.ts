import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  leagueTeamName,
  solveLeagueEntry,
  solveLeagueRanks,
} from "./league-teams.ts";
import type { KtcPricing, LineupLeagueRow } from "./league-teams.ts";
import { ktcPickKey } from "../ktc/picks.ts";
import { DYNASTY_LEAGUE_TYPE } from "./draft-picks.ts";
import type { LeagueRosterRow } from "./league-ranks.ts";
import type { RosProjections } from "../projections/ros.ts";
import type { AdpEntry } from "./adp-value.ts";

// Annotated at the wider of LineupLeagueRow's two rosters widths — a bare
// literal trips the excess-property check against the intersection.
const ROSTERS: LeagueRosterRow[] = [
  { roster_id: 1, owner_id: "me", players: ["w1"] },
  { roster_id: 2, owner_id: "t2", players: ["w2"] },
];

// A third roster, for the cases that need a board wide enough to have thirds.
const THREE_ROSTERS: LeagueRosterRow[] = [
  ...ROSTERS,
  { roster_id: 3, owner_id: "t3", players: [] },
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
  w1: {
    player_id: "w1",
    stats: { rec: 20 },
    weeks: [1],
    name: "W One",
    positions: ["WR"],
    team: null,
  },
  w2: {
    player_id: "w2",
    stats: { rec: 10 },
    weeks: [1],
    name: "W Two",
    positions: ["WR"],
    team: null,
  },
};

const NO_ADP = new Map<string, AdpEntry>();

/**
 * A KTC market with all three tiers of a 2027 first and a price for `w1` only,
 * so an unpriced player and an unpriced pick are both in every fixture.
 */
const KTC: KtcPricing = {
  values: new Map([["w1", 6000]]),
  picks: {
    [ktcPickKey("2027", 1, "early")]: { sf: 5000, oneqb: 5500 },
    [ktcPickKey("2027", 1, "mid")]: { sf: 4000, oneqb: 4400 },
    [ktcPickKey("2027", 1, "late")]: { sf: 3000, oneqb: 3300 },
  },
  superflex: false,
};

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
      { season: "2027", round: 1, slot: null, from: null, value: null },
      { season: "2027", round: 1, slot: null, from: "Slim", value: null },
    ]);
    assert.deepEqual(entry.teams[1]?.picks, []);
  });

  test("a league without the manager's roster composes to null", () => {
    assert.equal(
      solveLeagueEntry(row(), "nobody", "2026", PROJECTIONS, NO_ADP),
      null,
    );
  });

  // The narrowings reach the ranks, and reach a *team* only where a column
  // asked. Keys are spelled out rather than asked of `lineupColumnKey` here on
  // purpose — that agreement is pinned in `league-ranks.test.ts`, and what this
  // checks is the wire.
  test("a position narrowing reaches the ranks and leaves the teams alone", () => {
    const entry = solveLeagueEntry(
      row(),
      "me",
      "2026",
      PROJECTIONS,
      NO_ADP,
      undefined,
      [],
      [["WR"], ["QB"]],
    );
    assert.ok(entry);

    // Both rostered players are receivers, so the WR column is the whole
    // roster's answer and the QB column has nobody to rank.
    assert.deepEqual(entry.ranks.ros_starters, { rank: 1, of: 2 });
    assert.deepEqual(entry.ranks["ros_starters:wr"], { rank: 1, of: 2 });
    assert.equal(entry.ranks["ros_starters:qb"], null);

    // A team still carries the ten whole-roster totals and its own solve, and
    // nothing per-position beside them: the narrowing was ranked, not asked
    // for by a column that reads one across the league.
    assert.equal(entry.teams[0]?.totals.ros_starters, 20);
    assert.equal(entry.teams[0]?.totals["ros_starters:wr"], undefined);
    assert.equal(entry.teams[0]?.lineup.starters[0]?.player?.player_id, "w1");
  });

  /**
   * The seam the two narrowing axes were landed without, each with a note
   * saying it "arrives with a browser that can ask the question".
   *
   * The standings pane's column picker is that browser: it reads one column
   * across every roster, so a narrowed or forced column needs a total per team
   * rather than a rank.
   */
  test("a named column carries a total onto every team", () => {
    const entry = solveLeagueEntry(
      row(),
      "me",
      "2026",
      PROJECTIONS,
      NO_ADP,
      undefined,
      [],
      [["WR"]],
      [],
      [],
      new Set(["ros_starters:wr"]),
    );
    assert.ok(entry);

    // Both rosters hold receivers alone, so the narrowed column is the whole
    // roster's answer — which is the point: the number is the same one the
    // rank was made from, recorded rather than summed again.
    assert.equal(entry.teams[0]?.totals["ros_starters:wr"], 20);
    assert.equal(entry.teams[1]?.totals["ros_starters:wr"], 10);
    // The ten are untouched beside it.
    assert.equal(entry.teams[0]?.totals.ros_starters, 20);
  });

  test("a key nothing computed is absent rather than zero", () => {
    // A market this call was never given a pricing for. The route composes no
    // such key, so the total does not exist — which the pane draws an em dash
    // for, where a zero would be a price.
    const entry = solveLeagueEntry(
      row(),
      "me",
      "2026",
      PROJECTIONS,
      NO_ADP,
      undefined,
      [],
      [],
      [],
      [],
      new Set(["ktc_total:dynasty:sf"]),
    );
    assert.ok(entry);
    assert.equal(entry.teams[0]?.totals["ktc_total:dynasty:sf"], undefined);
  });
});

describe("solveLeagueEntry — KeepTradeCut", () => {
  /** Two rosters, each keeping its own 2027 first, on a set draft order. */
  function priced(overrides: Partial<LineupLeagueRow> = {}) {
    return row({
      drafts: [
        {
          draft_id: "d27",
          season: "2027",
          status: "pre_draft",
          type: "linear",
          start_time: 1,
          rounds: 1,
          teams: 2,
          reversal_round: null,
          draft_order: { me: 1, t2: 2 },
        },
      ],
      ...overrides,
    });
  }

  // Slot 1 of 2 is not a third of anything — `pickTier` refuses a board
  // narrower than its three tiers, and the mid row stands in, which is what
  // every unplaced pick gets. A three-roster board is what actually tiers.
  test("a placed pick takes its own third of the round", () => {
    const league = priced({
      league_type: DYNASTY_LEAGUE_TYPE,
      draft_rounds: 1,
      total_rosters: 3,
      rosters: THREE_ROSTERS,
      drafts: [
        {
          draft_id: "d27",
          season: "2027",
          status: "pre_draft",
          type: "linear",
          start_time: 1,
          rounds: 1,
          teams: 3,
          reversal_round: null,
          draft_order: { me: 1, t2: 2, t3: 3 },
        },
      ],
    });
    const entry = solveLeagueEntry(league, "me", "2026", PROJECTIONS, NO_ADP, KTC);
    assert.ok(entry);

    // Slot 1 of 3 is early, slot 2 mid, slot 3 late — each off its own row.
    // Only 2027 is on this fixture's board; the grid's other two seasons are
    // unpriced, which is what a pick past KTC's horizon looks like.
    assert.deepEqual(
      entry.teams.map(
        (t) => t.picks.find((p) => p.season === "2027")?.value ?? null,
      ),
      [5500, 4400, 3300],
    );
    assert.deepEqual(
      entry.teams[0]?.picks.map((p) => [p.season, p.value]),
      [
        ["2026", null],
        ["2027", 5500],
        ["2028", null],
      ],
    );
  });

  // Most picks on a board are seasons out and have no slot at all. KTC's
  // middle row is the stand-in every trade calculator uses, and it must be a
  // number rather than a refusal — the alternative reads as "no pick".
  test("an unplaced pick prices off the middle row", () => {
    const league = row({ drafts: [] });
    const entry = solveLeagueEntry(league, "me", "2026", PROJECTIONS, NO_ADP, {
      ...KTC,
      picks: KTC.picks,
    });
    assert.ok(entry);
    // No draft exists for 2027, so nothing is placed — but nothing is traded
    // either, and a non-dynasty grid is derived from the trades, so there are
    // no picks at all. The pick metric is then zero for everyone, which the
    // rank reads as "nothing to say".
    assert.deepEqual(entry.teams[0]?.picks, []);
    assert.equal(entry.teams[0]?.totals.ktc_picks, 0);
    assert.equal(entry.ranks.ktc_picks, null);
  });

  test("the four totals reconcile, and unpriced assets fall out of them", () => {
    const league = priced({
      traded_picks: [{ season: "2027", round: 1, roster_id: 2, owner_id: 1 }],
    });
    const entry = solveLeagueEntry(league, "me", "2026", PROJECTIONS, NO_ADP, KTC);
    assert.ok(entry);

    const mine = entry.teams[0]!;
    // Two picks on a two-wide board: neither is tiered, so both take the mid
    // row's 1QB price.
    assert.equal(mine.totals.ktc_picks, 8800);
    // `w1` is priced, `w2` is not — and roster 2 now owns no pick at all.
    assert.equal(mine.totals.ktc_starters, 6000);
    assert.equal(mine.totals.ktc_bench, 0);
    assert.equal(entry.teams[1]!.totals.ktc_total, 0);

    for (const team of entry.teams) {
      assert.equal(
        team.totals.ktc_total,
        team.totals.ktc_starters + team.totals.ktc_bench + team.totals.ktc_picks,
      );
    }
    assert.deepEqual(entry.ranks.ktc_total, { rank: 1, of: 2 });
  });

  test("superflex picks the other column, on players and picks alike", () => {
    const league = priced({
      traded_picks: [{ season: "2027", round: 1, roster_id: 2, owner_id: 1 }],
    });
    const entry = solveLeagueEntry(league, "me", "2026", PROJECTIONS, NO_ADP, {
      ...KTC,
      values: new Map([["w1", 9000]]),
      superflex: true,
    });
    assert.ok(entry);
    assert.equal(entry.teams[0]?.totals.ktc_starters, 9000);
    assert.equal(entry.teams[0]?.totals.ktc_picks, 8000);
  });

  // The board being unreadable is a degradation the route reaches for, and it
  // must land as "nothing to rank" rather than as a league-wide tie for first.
  test("no board at all leaves every KTC metric unranked", () => {
    const entry = solveLeagueEntry(priced(), "me", "2026", PROJECTIONS, NO_ADP);
    assert.ok(entry);
    assert.equal(entry.teams[0]?.lineup.starters[0]?.player?.ktc_value, null);
    assert.equal(entry.ranks.ktc_total, null);
    assert.equal(entry.ranks.ktc_starters, null);
    assert.equal(entry.ranks.ktc_bench, null);
    assert.equal(entry.ranks.ktc_picks, null);
  });
});

/**
 * The batched manager route's own answer: the same ranks, none of the teams.
 *
 * **The property worth pinning is the equality**, not the shape. A collapsed
 * card renders `ranks[key]` and the expanded one renders the teams; the split
 * is only safe while the two entry points agree about the first, and they agree
 * because they run one solve behind a shared core. A future edit that
 * "optimised" the ranks path by skipping a variant, a narrowing or the pick
 * board would show up here and nowhere on screen — a rank is a plausible number
 * whichever arithmetic produced it.
 */
describe("solveLeagueRanks", () => {
  /** Two rosters, each keeping its own 2027 first, on a set draft order. */
  function priced(overrides: Partial<LineupLeagueRow> = {}) {
    return row({
      drafts: [
        {
          draft_id: "d27",
          season: "2027",
          status: "pre_draft",
          type: "linear",
          start_time: 1,
          rounds: 1,
          teams: 2,
          reversal_round: null,
          draft_order: { me: 1, t2: 2 },
        },
      ],
      ...overrides,
    });
  }

  test("answers exactly the ranks solveLeagueEntry does", () => {
    const league = priced({
      traded_picks: [{ season: "2027", round: 1, roster_id: 2, owner_id: 1 }],
    });
    const entry = solveLeagueEntry(league, "me", "2026", PROJECTIONS, NO_ADP, KTC);
    const ranks = solveLeagueRanks(league, "me", "2026", PROJECTIONS, NO_ADP, KTC);
    assert.ok(entry);
    assert.deepEqual(ranks, entry.ranks);
  });

  test("agrees under a forced board and both narrowing axes", () => {
    const league = priced();
    const variants = [
      { key: "dynasty:sf", values: new Map([["w1", 9000]]), picks: KTC.picks, superflex: true },
    ];
    const positions: (readonly ("WR" | "QB")[])[] = [["WR"]];
    const slots: (readonly "FLEX"[])[] = [["FLEX"]];
    const entry = solveLeagueEntry(
      league, "me", "2026", PROJECTIONS, NO_ADP, KTC, variants, positions, [], slots,
    );
    const ranks = solveLeagueRanks(
      league, "me", "2026", PROJECTIONS, NO_ADP, KTC, variants, positions, [], slots,
    );
    assert.ok(entry);
    assert.deepEqual(ranks, entry.ranks);
    // And the keyed variants really were computed, so the equality above is
    // over something rather than over two empty records.
    assert.ok("ktc_total:dynasty:sf" in (ranks ?? {}));
    assert.ok("ros_starters:@flex:wr" in (ranks ?? {}));
  });

  // The manager route's own arm: the query filters these leagues out, so
  // reaching it means the store moved between reads and the league is dropped.
  test("a named manager holding no roster answers null, as the entry does", () => {
    const league = row();
    assert.equal(
      solveLeagueRanks(league, "nobody", "2026", PROJECTIONS, NO_ADP),
      null,
    );
    assert.equal(
      solveLeagueEntry(league, "nobody", "2026", PROJECTIONS, NO_ADP),
      null,
    );
  });

  // A league-scoped read has no manager, and every rank is null rather than
  // absent — the state a card draws an em dash for.
  test("a null manager ranks nothing and still answers", () => {
    const ranks = solveLeagueRanks(row(), null, "2026", PROJECTIONS, NO_ADP);
    assert.ok(ranks);
    assert.equal(ranks.ros_starters, null);
    assert.equal(ranks.capital_total, null);
  });
});
