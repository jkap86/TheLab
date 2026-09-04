import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { timelineEntry } from "./timeline-entry.ts";
import type { RosterTimelinePayload } from "@/shared/contract";

/**
 * A two-team league that swapped quarterbacks, and one pick.
 *
 * Alpha holds the *worse* quarterback today and held the better one before the
 * trade, which is the whole shape the past pane exists to show: scrub back and
 * Alpha's total goes up, priced on the board as it stands now.
 */
const pricing: NonNullable<RosterTimelinePayload["pricing"]> = {
  league: {
    total_rosters: 2,
    roster_positions: ["QB", "BN"],
    scoring_settings: { pass_td: 4 },
  },
  projections: {
    star: {
      player_id: "star",
      stats: { pass_td: 10 },
      weeks: [1],
      name: "Star",
      positions: ["QB"],
    },
    scrub: {
      player_id: "scrub",
      stats: { pass_td: 5 },
      weeks: [1],
      name: "Scrub",
      positions: ["QB"],
    },
  },
  adp: { star: { board: "full", adp: 1 } },
  ktc_values: { star: 9000, scrub: 1000 },
  picks: {
    "2027|1|1": { slot: 3, origin_name: "Alpha", value: 4000 },
    "2027|1|2": { slot: 7, origin_name: "Beta", value: 3000 },
  },
  from_week: 1,
  ktc: { board: "dynasty", updated_at: null },
};

const payload: RosterTimelinePayload = {
  timeline: {
    league_id: "L1",
    rosters: [
      {
        roster_id: 1,
        name: "Alpha",
        user_id: "u1",
        players: ["scrub"],
        picks: [{ season: "2027", round: 1, roster_id: 1 }],
      },
      {
        roster_id: 2,
        name: "Beta",
        user_id: "u2",
        players: ["star"],
        picks: [
          { season: "2027", round: 1, roster_id: 2 },
        ],
      },
    ],
    events: [
      {
        transaction_id: "t1",
        type: "trade",
        at: 1_000,
        roster_ids: [1, 2],
        // Alpha received the scrub and Beta the star, so before this Alpha held
        // the star. The pick went to Beta the same way.
        adds: { scrub: 1, star: 2 },
        drops: { scrub: 2, star: 1 },
        draft_picks: [
          {
            season: "2027",
            round: 1,
            roster_id: 2,
            owner_id: 2,
            previous_owner_id: 1,
          },
        ],
      },
    ],
  },
  players: {},
  pricing,
};

const teamOf = (entry: ReturnType<typeof timelineEntry>, rosterId: number) =>
  entry?.teams.find((t) => t.roster_id === rosterId);

describe("timelineEntry", () => {
  test("no timeline is no entry", () => {
    assert.equal(timelineEntry(null, 1, 1), null);
    assert.equal(
      timelineEntry({ timeline: null, players: {}, pricing: null }, 1, 1),
      null,
    );
  });

  test("now is the league as it stands, priced on today's board", () => {
    const entry = timelineEntry(payload, 0, 1);
    // 5 passing touchdowns at 4 points each, seated in the one QB slot.
    assert.equal(teamOf(entry, 1)?.totals.ros_starters, 20);
    assert.equal(teamOf(entry, 2)?.totals.ros_starters, 40);
  });

  test("a stop back prices the roster they *had* at today's values", () => {
    // The whole point: Alpha held the star before the trade, and the star is
    // worth 40 today — so scrubbing back is "what this team could have been".
    const entry = timelineEntry(payload, 1, 1);
    assert.equal(teamOf(entry, 1)?.totals.ros_starters, 40);
    assert.equal(teamOf(entry, 2)?.totals.ros_starters, 20);
  });

  test("every metric moves with the roster, not just points", () => {
    const now = timelineEntry(payload, 0, 1);
    const before = timelineEntry(payload, 1, 1);

    assert.equal(now && teamOf(now, 1)?.totals.ktc_starters, 1000);
    assert.equal(before && teamOf(before, 1)?.totals.ktc_starters, 9000);

    // Draft capital is priced off the same ADP board the card reads, and only
    // the star carries a number on it.
    assert.ok((teamOf(before, 1)?.totals.capital_total ?? 0) > 0);
    assert.equal(teamOf(now, 1)?.totals.capital_total, 0);
  });

  test("a rewound pick goes back to the roster that sent it, priced from its cell", () => {
    const before = timelineEntry(payload, 1, 1);
    const alpha = teamOf(before, 1);

    assert.deepEqual(
      alpha?.picks.map((p) => [p.season, p.round, p.slot, p.from, p.value]),
      [
        // Its own 2027 first, plus Beta's — which it held before the trade.
        ["2027", 1, 3, null, 4000],
        ["2027", 1, 7, "Beta", 3000],
      ],
    );
    assert.equal(alpha?.totals.ktc_picks, 7000);
  });

  test("ktc_total still reconciles at a past stop", () => {
    const before = timelineEntry(payload, 1, 1);
    for (const team of before?.teams ?? []) {
      assert.equal(
        team.totals.ktc_total,
        team.totals.ktc_starters + team.totals.ktc_bench + team.totals.ktc_picks,
      );
    }
  });

  test("the manager's team is marked by roster, and it is the one ranked", () => {
    const before = timelineEntry(payload, 1, 1);
    assert.deepEqual(
      before?.teams.map((t) => t.is_manager),
      [true, false],
    );
    // Alpha holds the better roster at this stop, so it ranks first of two.
    assert.deepEqual(before?.ranks.ros_starters, { rank: 1, of: 2 });
  });

  test("a manager the card has not named yet marks nothing and ranks nothing", () => {
    // The lineups read is still in flight — every roster is still solved, which
    // is what keeps the table drawable.
    const before = timelineEntry(payload, 1, null);
    assert.deepEqual(
      before?.teams.map((t) => t.is_manager),
      [false, false],
    );
    assert.equal(before?.ranks.ros_starters, null);
    assert.equal(teamOf(before, 1)?.totals.ros_starters, 40);
  });

  test("names come off the timeline, so a team is called one thing at every stop", () => {
    for (const back of [0, 1]) {
      assert.deepEqual(
        timelineEntry(payload, back, 1)?.teams.map((t) => t.name),
        ["Alpha", "Beta"],
      );
    }
  });

  test("no pricing is a table of dashes rather than no table", () => {
    const entry = timelineEntry({ ...payload, pricing: null }, 1, 1);
    assert.equal(entry?.teams.length, 2);
    assert.deepEqual(
      entry?.teams.map((t) => t.totals.ros_starters + t.totals.ktc_total),
      [0, 0],
    );
    // The rosters are still there to read, unpriced.
    assert.deepEqual(teamOf(entry, 1)?.lineup.bench.map((p) => p.player_id), [
      "star",
    ]);
  });

  test("a pick cell the table has no row for still draws, unpriced", () => {
    const thin = {
      ...payload,
      pricing: { ...pricing, picks: {} },
    };
    const alpha = teamOf(timelineEntry(thin, 1, 1), 1);
    assert.deepEqual(
      alpha?.picks.map((p) => [p.slot, p.from, p.value]),
      [
        [null, null, null],
        [null, "Roster 2", null],
      ],
    );
  });
});
