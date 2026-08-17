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
 * **The rank is bucketed at an hour ({@link kickoffRanks}), not read off the
 * instants.** What a broader seat buys is the *time* it stays open, so two
 * kickoffs twenty minutes apart are one seat's worth of flexibility, and asking
 * a manager to trade seats over them is a press that buys nothing. The NFL's
 * Sunday late window is exactly this case — 4:05 and 4:25 ET are two kickoffs
 * and one decision — and it is the common one, so without the buffer the column
 * read `2 to move` on lineups nobody would have moved, which is how a verdict
 * column stops being read at all.
 *
 * Pure and free of runtime imports for the usual two reasons: Node's test
 * runner resolves only relative `.ts` imports, and client code may deep-import
 * a pure module without dragging `pg` into the bundle. Eligibility and slot
 * breadth come from `./optimal`, so this module and the solver cannot disagree
 * about who may sit where.
 */

import { breadth, eligible } from "./optimal.ts";

/**
 * How far apart two kickoffs have to be before moving a seat between them is
 * worth a manager's press.
 *
 * An hour, which is a judgement about *news* rather than about the schedule: the
 * pivots a held flex is being held for — a late scratch, a surprise inactive,
 * a beat writer at warm-ups — break in the couple of hours before a game, so a
 * seat freed twenty minutes earlier frees nothing anyone could act on. It is a
 * bound on what the ordering will *ask for*, never on what it knows: the
 * instants themselves are untouched, and the lock (`./locks`) still settles a
 * seat to the minute.
 */
export const KICKOFF_BUFFER_MS = 60 * 60 * 1000;

/**
 * Kickoff instant → its rank in the week, with instants inside
 * {@link KICKOFF_BUFFER_MS} of each other sharing one rank. Duplicates and the
 * order the instants arrive in make no difference to the answer.
 *
 * **A bucket is measured from the instant that opened it, not from the one
 * before it**, and that is the whole subtlety. Chaining — a new bucket whenever
 * the *gap* to the previous instant clears the buffer — is transitive, so a week
 * of games fifty minutes apart collapses to a single rank however many hours it
 * spans, and the buffer would silently switch the whole ordering off. Measuring
 * from the anchor bounds every bucket at one buffer wide, which costs the pair
 * straddling a boundary (55 minutes apart, one rank each): they are separated by
 * *less* than the buffer and still generate a move. That is the honest trade —
 * the failure is one move too many at a boundary rather than the feature
 * quietly ceasing to work — and it is invisible on a real schedule, where the
 * NFL's windows sit hours apart and the pairs this exists for (4:05 and 4:25)
 * are minutes apart inside one of them.
 */
export function kickoffRanks(instants: readonly number[]): Map<number, number> {
  const ranks = new Map<number, number>();

  let anchor: number | null = null;
  let rank = -1;
  for (const at of [...new Set(instants)].sort((a, b) => a - b)) {
    if (anchor === null || at - anchor >= KICKOFF_BUFFER_MS) {
      anchor = at;
      rank += 1;
    }
    ranks.set(at, rank);
  }

  return ranks;
}

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
 * slots and later ones into broader slots wherever eligibility allows — where
 * "earlier" is by {@link KICKOFF_BUFFER_MS}, so a lineup whose starters all play
 * inside one hour of each other is already in order however their instants
 * differ.
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

  // Ranks rather than instants: two players kicking off within the buffer share
  // a rank, so they are interchangeable to the objective and the stay bonus
  // keeps both where they are. A whole lineup landing in one bucket leaves the
  // primary term constant, and the same bonus holds every seat.
  const rankOf = kickoffRanks(pool.map((p) => p.kickoff as number));

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

/** One seat change between a lineup and its kickoff-ordered re-seat. */
export type KickoffMove = {
  player_id: string;
  /** The slot he is seated in. */
  from: string;
  /** The slot the ordering seats him in instead. */
  to: string;
};

/**
 * The seat changes between a lineup and its kickoff-ordered re-seat, one per
 * player who moves.
 *
 * Derived rather than carried on the wire, and derived *here*, once: the
 * matchups route counts these for the lineup checker's column and the week
 * panel marks each moved player's row with his `to`, and two spellings of
 * "which seats changed" would let the count and the marks disagree.
 *
 * A move is a player whose **slot name** differs between the two lineups. Two
 * seats of one slot trading occupants would change indices and nothing a
 * reader could see — {@link orderLineupByKickoff} never produces one (equal
 * seats carry no ordering gain, and the fewest-moves tie-break keeps them
 * put), and a caller comparing arbitrary lineups shouldn't report it either.
 * Empty means already ordered; what a null ordering means is decided before
 * coming here, since null is "no answer" and there is nothing to diff.
 */
export function kickoffMoves(
  current: readonly KickoffSeat[],
  ordered: readonly KickoffSeat[],
): KickoffMove[] {
  const seatOf = new Map<string, string>();
  for (const seat of ordered) {
    if (seat.player_id) seatOf.set(seat.player_id, seat.slot);
  }

  const moves: KickoffMove[] = [];
  for (const seat of current) {
    if (!seat.player_id) continue;
    const to = seatOf.get(seat.player_id);
    if (to !== undefined && to !== seat.slot) {
      moves.push({ player_id: seat.player_id, from: seat.slot, to });
    }
  }
  return moves;
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
