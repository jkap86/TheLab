import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  KICKOFF_BUFFER_MS,
  kickoffMoves,
  kickoffRanks,
  orderLineupByKickoff,
} from "./kickoff-order.ts";
import type { KickoffPlayer, KickoffSeat } from "./kickoff-order.ts";

/**
 * The re-seat is advice a manager acts on before the early games, and a wrong
 * answer looks exactly like a right one — so the moves are pinned individually
 * (including the rotation pairwise swapping cannot reach) and the whole thing
 * is cross-checked against enumerating every legal seating at the end.
 */

// Thursday night, the Sunday 1 PM ET after it, that afternoon's late window,
// and Monday night — as epoch ms; only their order matters here.
const THU = 1789086000000;
const SUN_EARLY = 1789318800000;
const SUN_LATE = SUN_EARLY + 3.25 * 3600 * 1000;
const MON = SUN_EARLY + 30 * 3600 * 1000;

// The 4:25 ET games, twenty minutes after the 4:05s — one decision, two
// instants, and the pair the buffer exists for.
const SUN_LATER = SUN_LATE + 20 * 60 * 1000;

const p = (
  player_id: string,
  positions: string | string[],
  kickoff: number | null,
): KickoffPlayer => ({
  player_id,
  positions: Array.isArray(positions) ? positions : [positions],
  kickoff,
});

const seat = (slot: string, player_id: string | null): KickoffSeat => ({
  slot,
  player_id,
});

const ids = (lineup: readonly KickoffSeat[]) => lineup.map((s) => s.player_id);

describe("orderLineupByKickoff", () => {
  test("moves the early kickoff to the strict slot and the late one to the flex", () => {
    const players = [p("rb_late", "RB", MON), p("rb_early", "RB", THU)];
    const lineup = [seat("RB", "rb_late"), seat("FLEX", "rb_early")];

    assert.deepEqual(ids(orderLineupByKickoff({ lineup, players })), [
      "rb_early",
      "rb_late",
    ]);
  });

  test("leaves a lineup already in kickoff order alone", () => {
    const players = [p("rb_early", "RB", THU), p("rb_late", "RB", MON)];
    const lineup = [seat("RB", "rb_early"), seat("FLEX", "rb_late")];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
  });

  test("never suggests a seat Sleeper would refuse", () => {
    // The WR kicks off first, but he cannot take the RB slot — the only legal
    // seating is the one already set.
    const players = [p("wr_early", "WR", THU), p("rb_late", "RB", MON)];
    const lineup = [seat("RB", "rb_late"), seat("FLEX", "wr_early")];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
  });

  test("equal kickoffs move nobody", () => {
    // Both play Sunday at 1: the seats are interchangeable in time, so a swap
    // would be a move that changes nothing — the gratuitous diff this module
    // promises not to produce.
    const players = [p("rb1", "RB", SUN_EARLY), p("rb2", "RB", SUN_EARLY)];
    const lineup = [seat("FLEX", "rb1"), seat("RB", "rb2")];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
  });

  test("kickoffs inside the buffer move nobody", () => {
    // 4:05 and 4:25: the flex would be freed twenty minutes earlier, which is
    // no news anyone could act on, so the seats stay as they are.
    const players = [p("rb_405", "RB", SUN_LATE), p("rb_425", "RB", SUN_LATER)];
    const lineup = [seat("RB", "rb_425"), seat("FLEX", "rb_405")];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
  });

  test("a whole lineup inside one buffer is already in order", () => {
    const players = [
      p("rb_a", "RB", SUN_LATE + 15 * 60 * 1000),
      p("rb_b", "RB", SUN_LATE),
      p("rb_c", "RB", SUN_LATER),
    ];
    const lineup = [
      seat("RB", "rb_a"),
      seat("FLEX", "rb_b"),
      seat("SUPER_FLEX", "rb_c"),
    ];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
    assert.deepEqual(kickoffMoves(lineup, orderLineupByKickoff({ lineup, players })), []);
  });

  test("the buffer narrows what moves, it does not switch the ordering off", () => {
    // The 4:05/4:25 pair is one rank between them, so only the Monday game is
    // meaningfully later — it takes the flex and the pair keeps its seats.
    const players = [
      p("rb_405", "RB", SUN_LATE),
      p("rb_425", "RB", SUN_LATER),
      p("rb_mon", "RB", MON),
    ];
    const lineup = [
      seat("RB", "rb_405"),
      seat("FLEX", "rb_mon"),
      seat("WRRB_FLEX", "rb_425"),
    ];

    assert.deepEqual(ids(orderLineupByKickoff({ lineup, players })), [
      "rb_405",
      "rb_mon",
      "rb_425",
    ]);
  });

  test("a gap of exactly the buffer is a real gap", () => {
    // The boundary is inclusive — an hour apart is the shortest separation the
    // ordering is willing to act on, and it acts on it.
    const players = [
      p("rb_late", "RB", SUN_EARLY + KICKOFF_BUFFER_MS),
      p("rb_early", "RB", SUN_EARLY),
    ];
    const lineup = [seat("RB", "rb_late"), seat("FLEX", "rb_early")];

    assert.deepEqual(ids(orderLineupByKickoff({ lineup, players })), [
      "rb_early",
      "rb_late",
    ]);
  });

  test("a starter inside the buffer is not dragged along by one outside it", () => {
    // Buckets are measured from the instant that opened them, so the pair a
    // minute inside the buffer never chains onto the game an hour past it.
    const players = [
      p("rb_a", "RB", SUN_EARLY),
      p("rb_b", "RB", SUN_EARLY + KICKOFF_BUFFER_MS - 60_000),
      p("rb_c", "RB", SUN_EARLY + 2 * KICKOFF_BUFFER_MS),
    ];
    const lineup = [
      seat("RB", "rb_c"),
      seat("FLEX", "rb_a"),
      seat("WRRB_FLEX", "rb_b"),
    ];

    // `rb_a`/`rb_b` share a rank, so only `rb_c` is meaningfully later and it
    // takes the broadest seat. Chained buckets would have made all three one
    // rank and moved nobody, which is the answer this pins against.
    assert.deepEqual(ids(orderLineupByKickoff({ lineup, players })), [
      "rb_a",
      "rb_c",
      "rb_b",
    ]);
  });

  test("two seats of the same slot are never reshuffled", () => {
    // Two RB slots lock the same way whoever sits in which; so do two flexes.
    const players = [p("rb1", "RB", MON), p("rb2", "RB", THU)];

    const rbs = [seat("RB", "rb1"), seat("RB", "rb2")];
    assert.deepEqual(orderLineupByKickoff({ lineup: rbs, players }), rbs);

    const flexes = [seat("FLEX", "rb1"), seat("FLEX", "rb2")];
    assert.deepEqual(orderLineupByKickoff({ lineup: flexes, players }), flexes);
  });

  test("orders a whole chain of breadths, earliest into the strictest", () => {
    const players = [
      p("rb_early", "RB", THU),
      p("rb_mid", "RB", SUN_EARLY),
      p("rb_late", "RB", MON),
    ];
    const lineup = [
      seat("SUPER_FLEX", "rb_early"),
      seat("FLEX", "rb_late"),
      seat("RB", "rb_mid"),
    ];

    assert.deepEqual(ids(orderLineupByKickoff({ lineup, players })), [
      "rb_late",
      "rb_mid",
      "rb_early",
    ]);
  });

  test("finds the rotation when no two seats can legally swap", () => {
    // No pair here may trade: the WR can't take QB, the QB/RB can't take
    // REC_FLEX, the QB/TE can't take WRRB_FLEX. Rotating all three is legal and
    // moves the early game into the strict seat — the case that makes this an
    // assignment rather than the solver's pairwise canonicalisation.
    const players = [
      p("qb_rb", ["QB", "RB"], MON),
      p("wr", "WR", SUN_EARLY),
      p("qb_te", ["QB", "TE"], THU),
    ];
    const lineup = [
      seat("QB", "qb_rb"),
      seat("WRRB_FLEX", "wr"),
      seat("REC_FLEX", "qb_te"),
    ];

    assert.deepEqual(ids(orderLineupByKickoff({ lineup, players })), [
      "qb_te",
      "qb_rb",
      "wr",
    ]);
  });

  test("a locked player holds his seat, and the rest still order", () => {
    // The flex is already committed — its player kicked off Thursday — so the
    // remaining pair still trade, but nobody touches the settled seat.
    const players = [
      p("rb_played", "RB", THU),
      p("rb_mid", "RB", SUN_EARLY),
      p("rb_late", "RB", MON),
    ];
    const lineup = [
      seat("RB", "rb_late"),
      seat("FLEX", "rb_played"),
      seat("WRRB_FLEX", "rb_mid"),
    ];

    assert.deepEqual(
      ids(orderLineupByKickoff({ lineup, players, locked: new Set(["rb_played"]) })),
      ["rb_mid", "rb_played", "rb_late"],
    );
  });

  test("a player with no kickoff holds his seat", () => {
    // Null is "not known", never "never plays": a bye or a failed schedule
    // read must not fling a player to either end of the ordering.
    const players = [p("rb_bye", "RB", null), p("rb_late", "RB", MON)];
    const lineup = [seat("RB", "rb_late"), seat("FLEX", "rb_bye")];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
  });

  test("a schedule read that failed re-seats nobody", () => {
    const players = [p("rb1", "RB", null), p("rb2", "RB", null)];
    const lineup = [seat("RB", "rb1"), seat("FLEX", "rb2")];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
  });

  test("a starter the caller knows nothing about holds his seat", () => {
    const players = [p("rb_late", "RB", MON)];
    const lineup = [seat("RB", "rb_late"), seat("FLEX", "mystery")];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
  });

  test("an unrecognised slot is held while the rest still order", () => {
    const players = [
      p("idp", "LB", SUN_LATE),
      p("rb_early", "RB", THU),
      p("rb_late", "RB", MON),
    ];
    const lineup = [
      seat("WEIRD_FLEX", "idp"),
      seat("RB", "rb_late"),
      seat("FLEX", "rb_early"),
    ];

    assert.deepEqual(ids(orderLineupByKickoff({ lineup, players })), [
      "idp",
      "rb_early",
      "rb_late",
    ]);
  });

  test("an empty seat stays empty while the rest order around it", () => {
    // The empty RB slot would be the strictest home for the early game, but
    // moving a player into it changes which slots are manned — that is lineup
    // advice, and compareLineup's business, not a kickoff answer. The two
    // seated players still trade.
    const players = [p("rb_early", "RB", THU), p("rb_late", "RB", MON)];
    const lineup = [
      seat("RB", null),
      seat("FLEX", "rb_early"),
      seat("WRRB_FLEX", "rb_late"),
    ];

    assert.deepEqual(ids(orderLineupByKickoff({ lineup, players })), [
      null,
      "rb_late",
      "rb_early",
    ]);
  });

  test("a seating our own tables cannot explain is held, not corrected", () => {
    // Sleeper seated a TE at RB — whichever table is wrong, re-seating around
    // it would build advice on a fact this code cannot check.
    const players = [p("te_late", "TE", MON), p("rb_early", "RB", THU)];
    const lineup = [seat("RB", "te_late"), seat("FLEX", "rb_early")];

    assert.deepEqual(orderLineupByKickoff({ lineup, players }), lineup);
  });

  test("hands back fresh seats and never edits the input", () => {
    const players = [p("rb_late", "RB", MON), p("rb_early", "RB", THU)];
    const lineup = [seat("RB", "rb_late"), seat("FLEX", "rb_early")];

    const result = orderLineupByKickoff({ lineup, players });
    result[0].player_id = null;

    assert.deepEqual(lineup, [seat("RB", "rb_late"), seat("FLEX", "rb_early")]);
  });

  test("is indifferent to the order the players arrive in", () => {
    const players = [
      p("rb_early", "RB", THU),
      p("rb_mid", "RB", SUN_EARLY),
      p("rb_late", "RB", MON),
    ];
    const lineup = [
      seat("SUPER_FLEX", "rb_early"),
      seat("FLEX", "rb_late"),
      seat("RB", "rb_mid"),
    ];

    assert.deepEqual(
      orderLineupByKickoff({ lineup, players }),
      orderLineupByKickoff({ lineup, players: [...players].reverse() }),
    );
  });
});

describe("kickoffRanks", () => {
  test("ranks separated instants in order from zero", () => {
    assert.deepEqual(
      [...kickoffRanks([MON, THU, SUN_EARLY])],
      [
        [THU, 0],
        [SUN_EARLY, 1],
        [MON, 2],
      ],
    );
  });

  test("instants inside the buffer share a rank", () => {
    const ranks = kickoffRanks([SUN_LATE, SUN_LATER]);
    assert.equal(ranks.get(SUN_LATE), ranks.get(SUN_LATER));
  });

  test("the buffer is a floor on the gap, not a ceiling", () => {
    // Exactly an hour separates; a millisecond under does not.
    const ranks = kickoffRanks([
      SUN_EARLY,
      SUN_EARLY + KICKOFF_BUFFER_MS - 1,
      SUN_EARLY + KICKOFF_BUFFER_MS,
    ]);
    assert.equal(ranks.get(SUN_EARLY + KICKOFF_BUFFER_MS - 1), 0);
    assert.equal(ranks.get(SUN_EARLY + KICKOFF_BUFFER_MS), 1);
  });

  test("a bucket is measured from its anchor, so it never chains", () => {
    // Every neighbouring gap here is under the buffer, and a chained rule would
    // fold a five-hour afternoon into one rank — the whole ordering, off.
    const ranks = kickoffRanks(
      Array.from({ length: 6 }, (_, i) => SUN_EARLY + i * 50 * 60 * 1000),
    );
    assert.deepEqual([...ranks.values()], [0, 0, 1, 1, 2, 2]);
  });

  test("duplicates and arrival order make no difference", () => {
    const instants = [MON, SUN_LATER, THU, SUN_LATE];
    assert.deepEqual(
      [...kickoffRanks([...instants, ...instants])].sort((a, b) => a[0] - b[0]),
      [...kickoffRanks([...instants].reverse())].sort((a, b) => a[0] - b[0]),
    );
  });

  test("nothing to rank is an empty answer", () => {
    assert.deepEqual([...kickoffRanks([])], []);
  });
});

describe("kickoffMoves", () => {
  test("names each moved player with the seat he leaves and the one he takes", () => {
    const players = [p("rb_late", "RB", MON), p("rb_early", "RB", THU)];
    const lineup = [seat("RB", "rb_late"), seat("FLEX", "rb_early")];

    const moves = kickoffMoves(lineup, orderLineupByKickoff({ lineup, players }));
    assert.deepEqual(moves, [
      { player_id: "rb_late", from: "RB", to: "FLEX" },
      { player_id: "rb_early", from: "FLEX", to: "RB" },
    ]);
  });

  test("an ordered lineup has no moves, which is a real answer", () => {
    const lineup = [seat("RB", "rb_early"), seat("FLEX", "rb_late")];
    assert.deepEqual(kickoffMoves(lineup, lineup), []);
  });

  test("a move between two seats of one slot is not a move a reader can see", () => {
    // The ordering never produces one; a caller diffing arbitrary lineups
    // shouldn't report an index change no rendering could show.
    const current = [seat("RB", "rb1"), seat("RB", "rb2")];
    const swapped = [seat("RB", "rb2"), seat("RB", "rb1")];
    assert.deepEqual(kickoffMoves(current, swapped), []);
  });

  test("empty seats and players only one side knows are not moves", () => {
    const current = [seat("RB", null), seat("FLEX", "rb1"), seat("QB", "mystery")];
    const ordered = [seat("RB", null), seat("WRRB_FLEX", "rb1")];
    assert.deepEqual(kickoffMoves(current, ordered), [
      { player_id: "rb1", from: "FLEX", to: "WRRB_FLEX" },
    ]);
  });
});

describe("orderLineupByKickoff vs brute force", () => {
  test("matches enumerating every legal seating on 300 random lineups", () => {
    // The assignment is only right because of an argument about the objective;
    // this is the check that the argument survived the implementation. Brute
    // force scores every eligibility-respecting permutation of the starters on
    // (kickoff order, seats kept) and the function must achieve the best pair.
    const ALLOWED: Record<string, string[]> = {
      QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"],
      FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],
      WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"],
    };
    const SLOTS = Object.keys(ALLOWED);
    const POSITIONS = ["QB", "RB", "WR", "TE"];
    // `SUN_LATER` is twenty minutes after `SUN_LATE`, so a good share of these
    // lineups carry a pair the buffer has to fold — the case that would
    // otherwise only ever be exercised by the hand-written tests above.
    const KICKOFFS = [THU, SUN_EARLY, SUN_LATE, SUN_LATER, MON];

    // Seeded so a failure is reproducible; Math.random would report a
    // different counterexample every run.
    let random = 20260812;
    const rand = (n: number) => {
      random = (random * 1103515245 + 12345) & 0x7fffffff;
      return random % n;
    };

    for (let run = 0; run < 300; run++) {
      // Every seat gets an occupant built to be eligible for it (his first
      // position comes off the seat's own list), sometimes with a second
      // position so the overlapping flexes genuinely overlap.
      const slots = Array.from(
        { length: 2 + rand(4) },
        () => SLOTS[rand(SLOTS.length)],
      );
      const players = slots.map((slot, i) => {
        const positions = [ALLOWED[slot][rand(ALLOWED[slot].length)]];
        const extra = POSITIONS[rand(POSITIONS.length)];
        if (rand(2) === 0 && !positions.includes(extra)) positions.push(extra);
        return p(`p${i}`, positions, KICKOFFS[rand(KICKOFFS.length)]);
      });
      const lineup = slots.map((slot, i) => seat(slot, players[i].player_id));

      // The ranks come from the module, which is deliberate: what is being
      // cross-checked here is the *assignment* — that the Hungarian solve finds
      // the same optimum as enumerating every legal seating — and reimplementing
      // the buckets would only test that two copies of them agree. The bucketing
      // itself is pinned directly, above.
      const ranks = kickoffRanks(players.map((x) => x.kickoff as number));
      const score = (order: number[]): [number, number] => {
        let primary = 0;
        let stays = 0;
        order.forEach((pi, si) => {
          primary +=
            ALLOWED[slots[si]].length * (ranks.get(players[pi].kickoff as number) as number);
          if (pi === si) stays += 1;
        });
        return [primary, stays];
      };

      // Every eligibility-respecting permutation of the starters.
      let bestPrimary = -1;
      let bestStays = -1;
      const walk = (order: number[], used: Set<number>) => {
        if (order.length === slots.length) {
          const [primary, stays] = score(order);
          if (primary > bestPrimary || (primary === bestPrimary && stays > bestStays)) {
            bestPrimary = primary;
            bestStays = stays;
          }
          return;
        }
        for (let pi = 0; pi < players.length; pi++) {
          if (used.has(pi)) continue;
          const allowed = ALLOWED[slots[order.length]];
          if (!players[pi].positions.some((x) => allowed.includes(x))) continue;
          used.add(pi);
          order.push(pi);
          walk(order, used);
          order.pop();
          used.delete(pi);
        }
      };
      walk([], new Set());

      const result = orderLineupByKickoff({ lineup, players });
      const label = `slots ${slots.join("/")} and ${JSON.stringify(players)}`;

      // The answer is a legal seating of exactly the same starters…
      assert.deepEqual(
        result.map((s) => s.slot),
        slots,
        `reshaped the seats for ${label}`,
      );
      assert.deepEqual(
        [...ids(result)].sort(),
        players.map((x) => x.player_id).sort(),
        `changed who starts for ${label}`,
      );
      const chosen = result.map((s) =>
        players.findIndex((x) => x.player_id === s.player_id),
      );
      chosen.forEach((pi, si) => {
        assert.ok(
          players[pi].positions.some((x) => ALLOWED[slots[si]].includes(x)),
          `illegal seat for ${label}`,
        );
      });

      // …and it is the best one: kickoff order first, fewest moves among ties.
      const [primary, stays] = score(chosen);
      assert.equal(primary, bestPrimary, `out of order for ${label}`);
      assert.equal(stays, bestStays, `needless moves for ${label}`);
    }
  });
});
