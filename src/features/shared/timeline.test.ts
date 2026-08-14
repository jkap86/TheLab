import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  moveKindLabel,
  movedPlayerNames,
  timelineMoveCount,
  timelineOrigin,
  timelineRosters,
  timelineStop,
  tradeRosterIds,
} from "./timeline.ts";
import type {
  RosterTimelineEventPayload,
  RosterTimelinePayload,
} from "@/shared/contract";
import type { PlayerSummary } from "@/shared/players";

const event = (
  overrides: Partial<RosterTimelineEventPayload> = {},
): RosterTimelineEventPayload => ({
  transaction_id: "x",
  type: "waiver",
  at: 0,
  roster_ids: [],
  adds: {},
  drops: {},
  draft_picks: [],
  ...overrides,
});

/**
 * A two-team league: the trade moved `moved` from roster 2 to roster 1, then
 * roster 1 claimed `pickup` and roster 2 swapped `cut` for `late`.
 */
const payload = (): RosterTimelinePayload => ({
  timeline: {
    league_id: "L",
    anchor: { transaction_id: "t1", at: 100 },
    rosters: [
      { roster_id: 1, user_id: "u1", players: ["moved", "pickup"], picks: [] },
      { roster_id: 2, user_id: "u2", players: ["late"], picks: [] },
      { roster_id: 3, user_id: "u3", players: ["idle"], picks: [] },
    ],
    // Newest first, ending with the trade.
    events: [
      event({
        transaction_id: "w2",
        at: 300,
        roster_ids: [2],
        adds: { late: 2 },
        drops: { cut: 2 },
      }),
      event({
        transaction_id: "w1",
        at: 200,
        roster_ids: [1],
        adds: { pickup: 1 },
      }),
      event({
        transaction_id: "t1",
        type: "trade",
        at: 100,
        roster_ids: [1, 2],
        adds: { moved: 1 },
        drops: { moved: 2 },
      }),
    ],
  },
  players: {},
  managers: {},
});

/**
 * The same league read the way the leagues list asks for it: no anchoring trade,
 * so the rail runs to the oldest move on file and nothing on it "dealt".
 *
 * The events are deliberately the identical three, because the point being pinned
 * is that *only* the anchor differs — every stop, every rewind and every date is
 * the same answer read from the same log.
 */
const unanchored = (): RosterTimelinePayload => {
  const p = payload();
  p.timeline!.anchor = null;
  return p;
};

const names = (rosters: ReturnType<typeof timelineRosters>, id: number) =>
  rosters.find((r) => r.roster_id === id)?.players;

describe("timelineStop", () => {
  test("no timeline is one stop, and it is now", () => {
    const empty: RosterTimelinePayload = {
      timeline: null,
      players: {},
      managers: {},
    };
    assert.equal(timelineMoveCount(empty), 0);
    assert.deepEqual(timelineStop(empty, 0), {
      back: 0,
      kind: "now",
      event: null,
      at: null,
    });
  });

  test("zero back is the present, and it is named rather than dated", () => {
    // The most recent move is what produced today's rosters, but a reader has no
    // reason to read the present as "after w2" — so `at` is null and the sheet
    // says "Now".
    const stop = timelineStop(payload(), 0);
    assert.equal(stop.kind, "now");
    assert.equal(stop.at, null);
  });

  test("a stop in the middle is dated by the move that produced it", () => {
    // One move reversed leaves everything from w1 older standing, so this is the
    // league as w1 left it.
    const stop = timelineStop(payload(), 1);
    assert.equal(stop.kind, "after");
    assert.equal(stop.event?.transaction_id, "w1");
    assert.equal(stop.at, 200);
  });

  test("the far end is the league before the trade, named by the trade", () => {
    const stop = timelineStop(payload(), 3);
    assert.equal(stop.kind, "before");
    assert.equal(stop.event?.transaction_id, "t1");
    assert.equal(stop.at, 100);
  });

  test("a position past either end is clamped rather than refused", () => {
    // It arrives from a slider, so out of range means "as far as this goes".
    assert.deepEqual(timelineStop(payload(), 99), timelineStop(payload(), 3));
    assert.deepEqual(timelineStop(payload(), -1), timelineStop(payload(), 0));
  });
});

describe("timelineRosters", () => {
  test("zero back is the league exactly as it stands", () => {
    const rosters = timelineRosters(payload(), 0);
    assert.deepEqual(names(rosters, 1), ["moved", "pickup"]);
    assert.deepEqual(names(rosters, 2), ["late"]);
  });

  test("each step back undoes one more move", () => {
    assert.deepEqual(names(timelineRosters(payload(), 1), 2), ["cut"]);
    assert.deepEqual(names(timelineRosters(payload(), 2), 1), ["moved"]);
  });

  test("the far end is the league before the trade", () => {
    const rosters = timelineRosters(payload(), 3);
    assert.deepEqual(names(rosters, 1), []);
    assert.deepEqual(names(rosters, 2), ["cut", "moved"]);
  });

  test("every roster is drawn, including one no move named", () => {
    const rosters = timelineRosters(payload(), 3);
    assert.deepEqual(
      rosters.map((r) => r.roster_id).sort(),
      [1, 2, 3],
    );
    assert.deepEqual(names(rosters, 3), ["idle"]);
  });

  test("the rosters that dealt lead, and the order holds at every stop", () => {
    // Who dealt is a fact about the trade rather than about the moment, so a
    // dragging finger must not re-sort the blocks under it.
    for (const back of [0, 1, 2, 3]) {
      assert.deepEqual(
        timelineRosters(payload(), back).map((r) => r.roster_id),
        [1, 2, 3],
      );
    }
  });

  test("a roster that sat out the trade is marked as such", () => {
    const rosters = timelineRosters(payload(), 0);
    assert.deepEqual(
      rosters.map((r) => [r.roster_id, r.dealt]),
      [
        [1, true],
        [2, true],
        [3, false],
      ],
    );
  });

  test("picks travel back with the players", () => {
    const held = payload();
    held.timeline!.rosters[0].picks = [
      { season: "2027", round: 1, roster_id: 2 },
    ];
    held.timeline!.events[2].draft_picks = [
      {
        season: "2027",
        round: 1,
        roster_id: 2,
        owner_id: 1,
        previous_owner_id: 2,
      },
    ];

    const before = timelineRosters(held, 3);
    assert.deepEqual(before.find((r) => r.roster_id === 1)?.picks, []);
    assert.deepEqual(before.find((r) => r.roster_id === 2)?.picks, [
      { season: "2027", round: 1, roster_id: 2 },
    ]);
  });

  test("no timeline draws no rosters", () => {
    assert.deepEqual(timelineRosters(null, 0), []);
  });
});

describe("tradeRosterIds", () => {
  test("it is the oldest event's own rosters — the trade the rail is anchored on", () => {
    assert.deepEqual(tradeRosterIds(payload()), [1, 2]);
  });

  test("an unanchored rail names nobody, though its oldest move is a trade", () => {
    // The whole-league rail ends at the oldest move on file, which may perfectly
    // well *be* a trade — and it is not "this trade", because the reader did not
    // arrive from one. Reading the last event regardless is how every leagues-list
    // card would mark two rosters as having "dealt" in a deal nobody asked about.
    assert.deepEqual(tradeRosterIds(unanchored()), []);
  });

  test("no timeline names nobody", () => {
    assert.deepEqual(tradeRosterIds(null), []);
  });
});

describe("timelineOrigin", () => {
  test("an anchored rail names its far end after the trade it stops at", () => {
    const origin = timelineOrigin(payload());
    assert.equal(origin.key, "Trade");
    assert.match(origin.summary, /this trade/);
  });

  test("an unanchored rail promises no trade anywhere in its wording", () => {
    // The key, its hover and the readout are the three places a rail says what
    // its far end is, and on the leagues list none of them may say "trade" —
    // there isn't one, and a key labelled for a trade that does not exist is the
    // control lying about where it goes.
    const origin = timelineOrigin(unanchored());
    for (const line of [origin.key, origin.title, origin.summary]) {
      assert.doesNotMatch(line, /trade/i);
    }
  });

  test("it says *on file* rather than claiming the beginning of time", () => {
    // A reconstruction reaches exactly as far as this league's stored log, which
    // is one season. A far end promising more would be the one wrong answer here
    // that looks like a working one.
    assert.match(timelineOrigin(unanchored()).summary, /on file/);
  });

  test("no timeline reads as unanchored rather than throwing", () => {
    // The rail is drawn from the payload, and the payload arrives after its host
    // opens — so this is asked once per open before there is anything to ask
    // about.
    assert.equal(timelineOrigin(null).key, timelineOrigin(unanchored()).key);
  });
});

describe("an unanchored rail reads the same log the anchored one does", () => {
  test("the stops are identical, because only the far end's *name* differs", () => {
    for (const back of [0, 1, 2, 3, 99]) {
      assert.deepEqual(timelineStop(unanchored(), back), timelineStop(payload(), back));
    }
  });

  test("the rewind is identical, and the order falls back to roster id", () => {
    // Nothing dealt, so the sort has only its tiebreaker left — which is the same
    // order this league happens to be in either way, and is asserted here so a
    // change to the sort cannot quietly reorder one host and not the other.
    for (const back of [0, 1, 2, 3]) {
      const rows = timelineRosters(unanchored(), back);
      assert.deepEqual(
        rows.map((r) => r.roster_id),
        [1, 2, 3],
      );
      assert.deepEqual(
        rows.map((r) => r.players),
        timelineRosters(payload(), back).map((r) => r.players),
      );
      assert.deepEqual(
        rows.map((r) => r.dealt),
        [false, false, false],
      );
    }
  });
});

describe("moveKindLabel", () => {
  test("Sleeper's machine words are spelled out", () => {
    assert.equal(moveKindLabel("free_agent"), "Free agent");
    assert.equal(moveKindLabel("trade"), "Trade");
  });

  test("a type this app has not met is opened out rather than dropped", () => {
    // A blank stop reads as a rendering fault at exactly the moment a reader has
    // scrubbed to.
    assert.equal(moveKindLabel("some_new_kind"), "some new kind");
    assert.equal(moveKindLabel(null), "Move");
  });
});

describe("movedPlayerNames", () => {
  const player = (player_id: string, name: string): PlayerSummary => ({
    player_id,
    name,
    position: "WR",
    team: "LAR",
  });
  const players: Record<string, PlayerSummary> = {
    a: player("a", "Puka Nacua"),
    b: player("b", "Zay Flowers"),
  };

  test("both halves of a move count, and each player once", () => {
    // A waiver claim is an add and a drop, and a traded player is named by both
    // sides of the same move.
    assert.equal(
      movedPlayerNames(event({ adds: { a: 1 }, drops: { a: 2, b: 1 } }), players),
      "Puka Nacua, Zay Flowers",
    );
  });

  test("a player the cache cannot name falls back to his id", () => {
    assert.equal(movedPlayerNames(event({ adds: { zzz: 1 } }), players), "zzz");
  });

  test("past three the rest are counted rather than printed", () => {
    assert.equal(
      movedPlayerNames(
        event({ adds: { a: 1, b: 1, c: 1, d: 1, e: 1 } }),
        players,
      ),
      "Puka Nacua, Zay Flowers, c +2 more",
    );
  });

  test("a move that named nobody says nothing", () => {
    assert.equal(movedPlayerNames(event(), players), "");
    assert.equal(movedPlayerNames(null, players), "");
  });
});
