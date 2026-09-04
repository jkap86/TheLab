import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  moveKindLabel,
  movedPlayerNames,
  stopSummary,
  timelineCaveat,
  timelineMoveCount,
  timelinePickAssets,
  timelineRosterGroups,
  timelineRosters,
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
    rosters: [
      {
        roster_id: 1,
        name: "Alpha",
        players: ["moved", "pickup"],
        picks: [{ season: "2027", round: 1, roster_id: 2 }],
      },
      {
        roster_id: 2,
        name: "Beta",
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
  players: {},
};

describe("timelineMoveCount", () => {
  test("a missing payload is no rail at all", () => {
    assert.equal(timelineMoveCount(null), 0);
    assert.equal(timelineMoveCount({ timeline: null, players: {} }), 0);
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

describe("timelineRosterGroups", () => {
  const players = {
    qb: player("qb", "QB"),
    wr1: player("wr1", "WR"),
    wr2: player("wr2", "WR"),
  };

  test("positions come back in lineup order, players by name inside one", () => {
    const groups = timelineRosterGroups(["wr2", "qb", "wr1"], players);
    assert.deepEqual(
      groups.map((g) => g.position),
      ["QB", "WR"],
    );
    assert.deepEqual(
      groups[1].players.map((p) => p.name),
      ["WR1", "WR2"],
    );
  });

  test("Sleeper's padding is dropped, not drawn as a player", () => {
    assert.deepEqual(timelineRosterGroups(["", "0"], players), []);
  });

  test("an unplaceable player keeps his id and sorts last", () => {
    const groups = timelineRosterGroups(["stranger", "qb"], players);
    assert.deepEqual(
      groups.map((g) => g.position),
      ["QB", "—"],
    );
    assert.equal(groups[1].players[0].name, "stranger");
  });
});

describe("timelinePickAssets", () => {
  const rosters = timelineRosters(payload, 0);

  test("neither a slot nor a price is claimed at a past moment", () => {
    const [pick] = timelinePickAssets(rosters[0], rosters);
    assert.equal(pick.slot, null);
    assert.equal(pick.value, null);
  });

  test("origin is named only where it is somebody else's", () => {
    assert.equal(timelinePickAssets(rosters[0], rosters)[0].from, "Beta");

    const own = timelinePickAssets(
      { ...rosters[1], picks: [{ season: "2027", round: 2, roster_id: 2 }] },
      rosters,
    );
    assert.equal(own[0].from, null);
  });

  test("an origin the league no longer lists still names a roster", () => {
    const orphan = timelinePickAssets(
      { ...rosters[0], picks: [{ season: "2027", round: 3, roster_id: 9 }] },
      rosters,
    );
    assert.equal(orphan[0].from, "Roster 9");
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

  test("the far end is named by what it comes before", () => {
    assert.equal(
      stopSummary(timelineStop(payload, 2), {}),
      "before the oldest move on file",
    );
  });
});

describe("timelineCaveat", () => {
  test("it leads with the moment and then says how it is known", () => {
    assert.match(
      timelineCaveat("Sep 18, 2026", "after trade · Moved"),
      /^After trade · Moved\. Every roster as it stood on Sep 18, 2026, reconstructed/,
    );
  });

  test("a summary it has none of leaves a sentence rather than a stray full stop", () => {
    assert.match(timelineCaveat("this point", ""), /^Every roster as it stood/);
  });
});
