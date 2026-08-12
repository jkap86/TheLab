/**
 * Kickoff-ordered lineups: the same starters, re-seated so the lineup locks in
 * the friendliest possible order.
 *
 * A seat is committed from the moment its player kicks off. A strict slot
 * committing early costs almost nothing — only one position could ever sit
 * there — but a flex that kicks off at 1pm is a flex spent: every pivot that
 * needed it for the rest of the week (a late scratch, a surprise inactive,
 * news breaking on a bench player) is off the table. So earlier kickoffs
 * belong in stricter seats and later kickoffs in broader ones — the solver's
 * better-player-to-the-stricter-slot canonicalisation with time in place of
 * points. Points never enter into it: a re-seat starts the same players, so
 * the total is untouched and `compareLineup` stays the answer to *who* should
 * start; this answers who should sit *where*.
 *
 * It is solved as an assignment rather than by pairwise swaps, and the
 * difference is real: with a QB/RB kicking off late at QB, a WR mid-afternoon
 * in WRRB_FLEX and a QB/TE early in REC_FLEX, no two of the three may legally
 * trade seats, while rotating all three moves the early game into the strict
 * seat (the test pins that case). The objective is Σ breadth(seat) ×
 * kickoff-rank(player) — every change that moves a later kickoff into a
 * broader seat raises it — maximised exactly, and among equal optima the
 * arrangement keeping the most players in their current seats wins, so equal
 * kickoffs and equal-breadth seats never generate gratuitous moves.
 *
 * Pure and free of runtime imports for the usual two reasons: Node's test
 * runner resolves only relative `.ts` imports, and client code may deep-import
 * a pure module without dragging `pg` into the bundle. Eligibility and slot
 * breadth come from `./optimal`, so this module and the solver cannot disagree
 * about who may sit where.
 */

import { breadth, eligible } from "./optimal.ts";

/** One seat of a lineup: the slot, and who is in it (null for an empty seat). */
export type KickoffSeat = { slot: string; player_id: string | null };

/** A starter, with what re-seating him needs to know. */
export type KickoffPlayer = {
  player_id: string;
  /** Sleeper's `fantasy_positions` — what decides which seats he may take. */
  positions: string[];
  /**
   * Kickoff of his game this week, epoch ms (`weekKickoffs` in
   * `shared/schedule` reads it off the schedule call). Null is "not known",
   * never "never plays" — a bye or a failed schedule read holds his seat
   * rather than sorting him anywhere.
   */
  kickoff: number | null;
};

/**
 * Re-seat a starting lineup so it locks strict-seats-first: the same seats in
 * the same order, the same starters, with earlier kickoffs moved into stricter
 * slots and later ones into broader slots wherever eligibility allows.
 *
 * The set of starters is never changed — a player only ever moves to another
 * seat — and a seat is *held* exactly as it stands (its player out of the
 * pool, its slot out of bounds for everyone else) whenever a move can't be
 * proven both legal and worth making:
 *
 * - an empty seat — "leave your RB slot open instead" is not a kickoff answer;
 * - a slot this vocabulary doesn't recognise;
 * - a player the caller knows nothing about, or one his own seat says our
 *   eligibility table is wrong about — either way, advice built on that table
 *   would be a move Sleeper may refuse;
 * - a player with no kickoff, so a schedule read that failed re-seats nobody
 *   rather than everybody;
 * - a player in `locked`, whose game has already been played. The caller
 *   supplies that the way `compareLineup` takes it — this module reads no
 *   clock of its own.
 *
 * Deterministic for a given lineup, and indifferent to the order of `players`.
 * Returns a fresh array of fresh seats; the input is never edited.
 */
export function orderLineupByKickoff({
  lineup,
  players,
  locked,
}: {
  lineup: readonly KickoffSeat[];
  players: readonly KickoffPlayer[];
  /** Players whose games have been played — see the note above. */
  locked?: ReadonlySet<string>;
}): KickoffSeat[] {
  const byId = new Map(players.map((p) => [p.player_id, p]));
  const result = lineup.map((seat) => ({ slot: seat.slot, player_id: seat.player_id }));

  const movable: number[] = [];
  for (let i = 0; i < lineup.length; i++) {
    const id = lineup[i].player_id;
    if (!id || locked?.has(id)) continue;
    const player = byId.get(id);
    if (!player || player.kickoff === null) continue;
    if (!eligible(lineup[i].slot, player.positions)) continue;
    movable.push(i);
  }
  if (movable.length < 2) return result;

  const pool = movable.map((i) => byId.get(lineup[i].player_id as string) as KickoffPlayer);

  // Ranks rather than instants: two players sharing a kickoff share a rank, so
  // they are truly interchangeable and the stay bonus keeps both where they are.
  const instants = [...new Set(pool.map((p) => p.kickoff as number))].sort((a, b) => a - b);
  const rankOf = new Map(instants.map((at, rank) => [at, rank]));

  // The stay bonus is a strict tie-break: at most n are collectable, so scaling
  // the primary term by n + 1 keeps one unit of kickoff order worth more than
  // every kept seat together.
  const n = movable.length;
  const SCALE = n + 1;

  // An ineligible pairing is priced below any all-eligible matching — each
  // movable player is eligible for his own seat, so one always exists and the
  // optimum never has to touch these.
  const maxBreadth = Math.max(...movable.map((i) => breadth(lineup[i].slot)));
  const FORBIDDEN = -(1 + n * (maxBreadth * n * SCALE + 1));

  const weights = movable.map((seatIndex) => {
    const slot = lineup[seatIndex].slot;
    const seatBreadth = breadth(slot);
    return pool.map((player) => {
      if (!eligible(slot, player.positions)) return FORBIDDEN;
      const rank = rankOf.get(player.kickoff as number) as number;
      const stays = lineup[seatIndex].player_id === player.player_id ? 1 : 0;
      return seatBreadth * rank * SCALE + stays;
    });
  });

  const seated = bestAssignment(weights);
  movable.forEach((seatIndex, si) => {
    result[seatIndex].player_id = pool[seated[si]].player_id;
  });
  return result;
}

/**
 * Maximum-weight perfect assignment of seats to players — the Hungarian
 * algorithm with potentials, O(n³) over a square integer matrix. A lineup is a
 * dozen seats, so exact is cheap; what it buys over the pairwise swaps
 * `canonicalise` settles for is the rotations, which the module note argues
 * are real here. The brute-force test cross-checks it against enumerating
 * every legal seating.
 */
function bestAssignment(weights: number[][]): number[] {
  const n = weights.length;

  // The textbook algorithm minimises a non-negative matrix, so run it over
  // `cap - weight`: a perfect matching has exactly n edges, so the shift moves
  // every candidate by the same amount and the argmin is the argmax wanted.
  let cap = 0;
  for (const row of weights) for (const w of row) cap = Math.max(cap, w);

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  // owner[j]: which seat (1-based) currently holds player j; owner[0] is the
  // seat being placed this round.
  const owner = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    owner[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = owner[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cost = cap - weights[i0 - 1][j - 1] - u[i0] - v[j];
        if (cost < minv[j]) {
          minv[j] = cost;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[owner[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (owner[j0] !== 0);

    do {
      const j1 = way[j0];
      owner[j0] = owner[j1];
      j0 = j1;
    } while (j0);
  }

  const seatToPlayer = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (owner[j] > 0) seatToPlayer[owner[j] - 1] = j - 1;
  }
  return seatToPlayer;
}
