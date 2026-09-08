import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  moveKindLabel,
  movedPlayerNames,
  stopSummary,
  timelineCaveat,
  timelineEarlier,
  timelineMoveCount,
  timelineRosters,
  timelineSeasonBoundaries,
  timelineStop,
} from "./timeline.ts";
import type {
  PlayerSummary,
  RosterTimelinePayload,
  TimelineEventPayload,
} from "@/shared/contract";

const event = (
  overrides: Partial<TimelineEventPayload> = {},
): TimelineEventPayload => ({
  transaction_id: "t1",
  type: "trade",
  at: 3_000,
  roster_ids: [1, 2],
  adds: {},
  drops: {},
  draft_picks: [],
  ...overrides,
});

const player = (id: string, position: string | null = "WR"): PlayerSummary => ({
  player_id: id,
  name: id.toUpperCase(),
  position,
  team: null,
});

/**
 * A two-team league, newest move first: a waiver on roster 2, then a trade that
 * sent `moved` from roster 2 to roster 1.
 */
const payload: RosterTimelinePayload = {
  timeline: {
    league_id: "L1",
    earlier_league_id: null,
    seasons: [
      {
        league_id: "L1",
        season: "2026",
        rosters: [
          {
            roster_id: 1,
            name: "Alpha",
            user_id: "u1",
            players: ["moved", "pickup"],
            picks: [{ season: "2027", round: 1, roster_id: 2 }],
          },
          {
            roster_id: 2,
            name: "Beta",
            user_id: "u2",
            players: ["late"],
            picks: [],
          },
        ],
        events: [
          event({
            transaction_id: "w1",
            type: "waiver",
            at: 3_000,
            roster_ids: [2],
            adds: { late: 2 },
            drops: { "cut-late": 2 },
          }),
          event({
            transaction_id: "t1",
            type: "trade",
            at: 1_000,
            roster_ids: [1, 2],
            adds: { moved: 1 },
            drops: { moved: 2 },
            draft_picks: [
              {
                season: "2027",
                round: 1,
                roster_id: 2,
                owner_id: 1,
                previous_owner_id: 2,
              },
            ],
          }),
        ],
      },
    ],
  },
  players: {},
  pricing: null,
};

/**
 * The same league with the season before it in hand, and one before *that* still
 * to fetch.
 *
 * The 2025 rosters deliberately share **no player** with the 2026 ones, which is
 * what makes the soundness claim testable: an earlier season is rewound from its
 * own stored rosters, so nothing of this year may appear in it. `u1` holds
 * roster 2 that year rather than roster 1, which is what a roster id not
 * surviving a boundary looks like.
 */
const chained: RosterTimelinePayload = {
  timeline: {
    league_id: "L1",
    earlier_league_id: "L0",
    seasons: [
      payload.timeline!.seasons[0],
      {
        league_id: "L2025",
        season: "2025",
        rosters: [
          {
            roster_id: 1,
            name: "Gamma",
            user_id: "u3",
            players: ["old-a"],
            picks: [],
          },
          {
            roster_id: 2,
            name: "Alpha (2025)",
            user_id: "u1",
            players: ["old-b"],
            picks: [],
          },
        ],
        events: [
          event({
            transaction_id: "o1",
            type: "free_agent",
            at: 500,
            roster_ids: [1],
            adds: { "old-a": 1 },
            drops: {},
          }),
        ],
      },
    ],
  },
  players: {},
  pricing: null,
};

describe("timelineMoveCount", () => {
  test("a missing payload is no rail at all", () => {
    assert.equal(timelineMoveCount(null), 0);
    assert.equal(
      timelineMoveCount({ timeline: null, players: {}, pricing: null }),
      0,
    );
  });

  test("one stop per move", () => {
    assert.equal(timelineMoveCount(payload), 2);
  });
});

describe("timelineStop", () => {
  test("zero is now, and now is not dated by a move", () => {
    const stop = timelineStop(payload, 0);
    assert.equal(stop.kind, "now");
    assert.equal(stop.at, null);
    assert.equal(stop.back, 0);
  });

  test("a middle stop is named and dated by the move that produced it", () => {
    const stop = timelineStop(payload, 1);
    assert.equal(stop.kind, "after");
    assert.equal(stop.event?.transaction_id, "t1");
    assert.equal(stop.at, 1_000);
  });

  test("the far end is named by the oldest move, which it comes before", () => {
    const stop = timelineStop(payload, 2);
    assert.equal(stop.kind, "before");
    assert.equal(stop.event?.transaction_id, "t1");
    assert.equal(stop.at, 1_000);
  });

  test("a position past either end is clamped rather than rejected", () => {
    assert.equal(timelineStop(payload, 99).back, 2);
    assert.equal(timelineStop(payload, -4).kind, "now");
  });

  test("no timeline is a stop with nothing to say", () => {
    const stop = timelineStop(null, 3);
    assert.equal(stop.kind, "now");
    assert.equal(stop.event, null);
  });
});

describe("timelineRosters", () => {
  test("now is the payload's own rosters", () => {
    const rosters = timelineRosters(payload, 0);
    assert.deepEqual(
      rosters.map((r) => r.players),
      [["moved", "pickup"], ["late"]],
    );
  });

  test("a stop reverses exactly the moves newer than it", () => {
    const rosters = timelineRosters(payload, 1);
    assert.deepEqual(rosters[1].players, ["cut-late"]);
    assert.deepEqual(rosters[0].players, ["moved", "pickup"]);
  });

  test("the far end puts the traded player and the pick back", () => {
    const [alpha, beta] = timelineRosters(payload, 2);
    assert.deepEqual(alpha.players, ["pickup"]);
    assert.deepEqual(alpha.picks, []);
    assert.deepEqual(beta.players, ["cut-late", "moved"]);
    assert.deepEqual(beta.picks, [{ season: "2027", round: 1, roster_id: 2 }]);
  });

  test("the order is the league's own at every stop, and so are the names", () => {
    for (const back of [0, 1, 2]) {
      assert.deepEqual(
        timelineRosters(payload, back).map((r) => [r.roster_id, r.name]),
        [
          [1, "Alpha"],
          [2, "Beta"],
        ],
      );
    }
  });

  test("no timeline draws nothing rather than an empty league", () => {
    assert.deepEqual(timelineRosters(null, 1), []);
  });
});

describe("moveKindLabel", () => {
  test("the kinds this app has met", () => {
    assert.equal(moveKindLabel("trade"), "Trade");
    assert.equal(moveKindLabel("free_agent"), "Free agent");
  });

  test("one it has not is opened up rather than dropped", () => {
    assert.equal(moveKindLabel("some_new_kind"), "some new kind");
    assert.equal(moveKindLabel(null), "Move");
  });
});

describe("movedPlayerNames", () => {
  const players = {
    a: player("a"),
    b: player("b"),
    c: player("c"),
    d: player("d"),
  };

  test("both halves count, and neither is signed", () => {
    assert.equal(
      movedPlayerNames(event({ adds: { a: 1 }, drops: { b: 2 } }), players),
      "A, B",
    );
  });

  test("an unnamed player keeps his id", () => {
    assert.equal(movedPlayerNames(event({ adds: { zzz: 1 } }), players), "zzz");
  });

  test("past three the rest are counted", () => {
    assert.equal(
      movedPlayerNames(
        event({ adds: { a: 1, b: 1, c: 1, d: 1 } }),
        players,
      ),
      "A, B, C +1 more",
    );
  });

  test("a move that touched nobody says nothing", () => {
    assert.equal(movedPlayerNames(event(), players), "");
    assert.equal(movedPlayerNames(null, players), "");
  });
});

describe("stopSummary", () => {
  test("the present is named rather than dated", () => {
    assert.equal(stopSummary(timelineStop(payload, 0), {}), "as they stand today");
  });

  test("a middle stop names the move and who it touched", () => {
    assert.equal(
      stopSummary(timelineStop(payload, 1), {
        moved: player("moved"),
      }),
      "after trade · MOVED",
    );
  });

  test("a move that named nobody still says what kind it was", () => {
    assert.equal(stopSummary(timelineStop(payload, 1), {}), "after trade · moved");
  });

  test("the far end is named by what it comes before, and by its year", () => {
    assert.equal(
      stopSummary(timelineStop(payload, 2), {}),
      "before the oldest 2026 move on file",
    );
  });
});

describe("timelineCaveat", () => {
  test("it leads with the moment and then says how it is known", () => {
    assert.match(
      timelineCaveat(
        timelineStop(payload, 1),
        "Sep 18, 2026",
        "after trade · Moved",
      ),
      /^After trade · Moved\. Every roster as it stood on Sep 18, 2026, reconstructed/,
    );
  });

  test("it says the numbers are today's, which is the claim it exists to make", () => {
    assert.match(
      timelineCaveat(timelineStop(payload, 1), "Sep 18, 2026", ""),
      /priced at today's values/,
    );
  });

  test("a summary it has none of leaves a sentence rather than a stray full stop", () => {
    assert.match(
      timelineCaveat(timelineStop(payload, 1), null, ""),
      /^Every roster as it stood at this point/,
    );
  });

  test("an earlier season says what it was rewound from, which is not today", () => {
    const caveat = timelineCaveat(timelineStop(chained, 4), "Feb 1, 2025", "");
    assert.match(caveat, /that season's final rosters/);
    assert.match(caveat, /every 2025 move since/);
  });

  test("a season's end is the state Sleeper kept, and carries no date", () => {
    const caveat = timelineCaveat(timelineStop(chained, 3), null, "");
    assert.match(caveat, /as Sleeper kept it when the 2025 season rolled over/);
    assert.doesNotMatch(caveat, /undoing every/);
    assert.match(caveat, /priced at today's values/);
  });
});

describe("a chain of seasons", () => {
  test("the rail spans every season, one stop per move plus each season's end", () => {
    // 2026 contributes now + two moves; 2025 contributes its end + one move.
    assert.equal(timelineMoveCount(chained), 4);
  });

  test("the boundary is where the rail crosses a year, and only there", () => {
    assert.deepEqual(timelineSeasonBoundaries(chained), [3]);
    assert.deepEqual(timelineSeasonBoundaries(payload), []);
  });

  test("a stop carries the season it is in and the count within it", () => {
    const inThisYear = timelineStop(chained, 2);
    assert.equal(inThisYear.season, "2026");
    assert.equal(inThisYear.seasonIndex, 0);
    assert.equal(inThisYear.localBack, 2);

    const lastYear = timelineStop(chained, 4);
    assert.equal(lastYear.season, "2025");
    assert.equal(lastYear.leagueId, "L2025");
    assert.equal(lastYear.seasonIndex, 1);
    assert.equal(lastYear.localBack, 1);
  });

  test("the first stop over a boundary is that season's end, not a second now", () => {
    const stop = timelineStop(chained, 3);
    assert.equal(stop.kind, "season-end");
    assert.equal(stop.localBack, 0);
    // No move produced it, so nothing dates it — a season's final rosters stood
    // from its last recorded move until the league rolled over.
    assert.equal(stop.event, null);
    assert.equal(stop.at, null);
  });

  test("an earlier season is rewound from its own rosters, never this year's", () => {
    const rosters = timelineRosters(chained, 3);
    assert.deepEqual(
      rosters.map((r) => [r.roster_id, r.name, r.players]),
      [
        [1, "Gamma", ["old-a"]],
        [2, "Alpha (2025)", ["old-b"]],
      ],
    );
    // The claim this whole arrangement turns on: no player of the season after
    // it appears, because nothing was carried across the boundary.
    const carried = rosters.flatMap((r) => r.players);
    assert.equal(carried.includes("moved"), false);
    assert.equal(carried.includes("pickup"), false);
  });

  test("that season's own moves reverse inside it", () => {
    const [gamma] = timelineRosters(chained, 4);
    assert.deepEqual(gamma.players, []);
  });

  test("crossing a boundary changes nothing about the season before it", () => {
    // Every stop in the head season is what it was without a chain behind it.
    for (const back of [0, 1, 2]) {
      assert.deepEqual(
        timelineRosters(chained, back).map((r) => r.players),
        timelineRosters(payload, back).map((r) => r.players),
      );
    }
  });

  test("each end of a season names the year, since neither is dated by a move", () => {
    assert.equal(
      stopSummary(timelineStop(chained, 3), {}),
      "as the 2025 season ended",
    );
    assert.equal(
      stopSummary(timelineStop(chained, 4), {}),
      "before the oldest 2025 move on file",
    );
  });

  test("the offer names the season it comes before, not a year it has guessed", () => {
    assert.deepEqual(timelineEarlier(chained), {
      leagueId: "L0",
      beforeSeason: "2025",
    });
  });

  test("a complete chain offers nothing", () => {
    assert.equal(timelineEarlier(payload), null);
    assert.equal(timelineEarlier(null), null);
  });
});
