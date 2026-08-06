/**
 * Optimal lineups: which rostered players should start, given a league's slots
 * and a projection for each player.
 *
 * Pure and free of runtime imports so it can be unit-tested — the caller supplies
 * the roster, the slots and the already-scored players (see `./score`). The slot
 * vocabulary lives in `./slots`, imported with an explicit `.ts` extension so
 * Node's test runner can resolve it (it strips types but doesn't know the `@/*`
 * aliases).
 */

import { NON_STARTING_SLOTS, SLOT_POSITIONS } from "./slots.ts";

/** A rostered player, scored for the week under the league's own scoring. */
export type RosterPlayer = {
  player_id: string;
  /** Sleeper's `fantasy_positions` — several for a player with dual eligibility. */
  positions: string[];
  /** Projected points. A player with no projection is a real zero, not a gap. */
  points: number;
};

/** One slot of a lineup, filled or empty. */
export type LineupSlot = {
  slot: string;
  player_id: string | null;
  points: number;
};

export type LineupComparison = {
  /** The best lineup available from this roster, in slot order. */
  optimal: LineupSlot[];
  /** What is actually starting, in the same slot order. */
  current: LineupSlot[];
  optimal_points: number;
  current_points: number;
  /** Points the current lineup is leaving on the bench; 0 when already optimal. */
  points_left: number;
  /** Benched players the optimal lineup starts. */
  start: string[];
  /** Started players the optimal lineup benches. */
  sit: string[];
  /**
   * Slots in `roster_positions` this code doesn't recognise, left out of both
   * lineups. Non-empty means the comparison covers only part of the lineup and
   * shouldn't be presented as complete.
   */
  unknown_slots: string[];
};

/** Whether a player is eligible for a slot. Unknown slots take nobody. */
function eligible(slot: string, positions: string[]): boolean {
  const allowed = SLOT_POSITIONS[slot];
  return allowed ? positions.some((p) => allowed.includes(p)) : false;
}

/** The starting slots of a league's `roster_positions`, in order. */
export function startingSlots(rosterPositions: readonly string[]): string[] {
  return rosterPositions.filter((slot) => !NON_STARTING_SLOTS.has(slot));
}

/**
 * The starting slots this solver knows how to fill.
 *
 * A slot with no entry in {@link SLOT_POSITIONS} is eligible for nobody, so
 * leaving it in a lineup contributes an empty seat scoring zero and quietly
 * drags a team's total down. {@link compareLineup} drops those and names them in
 * `unknown_slots`; the batch entry points in `./outlook` have no panel to report
 * them on and simply leave them out. Both go through here, so "startable" means
 * one thing across the three.
 */
export function recognisedSlots(rosterPositions: readonly string[]): string[] {
  return startingSlots(rosterPositions).filter((slot) => slot in SLOT_POSITIONS);
}

/**
 * Two decimals — points arrive rounded there and summing reintroduces noise.
 * Exported for `./weekly`, which sums this module's lineups across a horizon
 * and must round on the same convention.
 */
export const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * The highest-scoring legal lineup for these slots.
 *
 * Players are considered in descending points and each is kept if the lineup can
 * still be filled with everyone kept so far — testing that by looking for an
 * augmenting path, which may shuffle earlier players between slots but never
 * drops one. That ordering is what makes this optimal rather than merely good:
 * because a player's points don't depend on which slot they fill, the startable
 * sets form a matroid, and taking the best element that keeps the set feasible is
 * exactly the matroid greedy algorithm.
 *
 * The naive alternative — walk the slots, give each its best remaining player —
 * is not optimal. With a `WRRB_FLEX` and a `REC_FLEX` open and WR 10 / RB 8 / TE
 * 3 on the bench, filling the WRRB slot first takes the WR and strands the RB for
 * 13 points, where starting the WR in the REC slot scores 18.
 */
export function optimalLineup(
  slots: readonly string[],
  players: readonly RosterPlayer[],
): LineupSlot[] {
  const filled: (RosterPlayer | null)[] = slots.map(() => null);

  // Ties broken on player_id so the same roster always produces the same lineup;
  // an advice tool that reshuffles its recommendation on reload isn't trusted.
  const byPoints = [...players].sort(
    (a, b) => b.points - a.points || a.player_id.localeCompare(b.player_id),
  );

  const assign = (player: RosterPlayer, tried: Set<number>): boolean => {
    for (let i = 0; i < slots.length; i++) {
      if (tried.has(i) || !eligible(slots[i], player.positions)) continue;
      tried.add(i);

      const current = filled[i];
      if (current === null || assign(current, tried)) {
        filled[i] = player;
        return true;
      }
    }
    return false;
  };

  for (const player of byPoints) assign(player, new Set());
  canonicalise(slots, filled);

  return slots.map((slot, i) => ({
    slot,
    player_id: filled[i]?.player_id ?? null,
    points: filled[i]?.points ?? 0,
  }));
}

/** How many positions a slot accepts. A strict slot is a more constrained home. */
const breadth = (slot: string): number => SLOT_POSITIONS[slot]?.length ?? 0;

/**
 * Settle which of two interchangeable slots each chosen player occupies: the
 * better player goes in the stricter slot, and among equally strict slots he goes
 * in the earlier one.
 *
 * The matching above is optimal but arbitrary about this, because augmenting
 * paths displace players sideways — it will happily seat a 15-point back in FLEX
 * and a 14-point back at RB, or the worse of two backs in the first of two RB
 * slots. Same total either way, but as advice it reads as a mistake, and diffing
 * it against a sane current lineup invents two pointless moves.
 *
 * Only ever swaps two seated players between their slots, so the set of starters
 * and the total are untouched. It terminates because every swap moves the better
 * player to the more preferred slot, which strictly decreases a bounded ordering.
 */
function canonicalise(
  slots: readonly string[],
  filled: (RosterPlayer | null)[],
): void {
  /** Whether slot `i` is the one of the pair that should hold the better player. */
  const prefers = (i: number, j: number): boolean => {
    const a = breadth(slots[i]);
    const b = breadth(slots[j]);
    return a < b || (a === b && i < j);
  };

  for (let pass = 0; pass < slots.length; pass++) {
    let swapped = false;

    for (let i = 0; i < slots.length; i++) {
      for (let j = 0; j < slots.length; j++) {
        const a = filled[i];
        const b = filled[j];
        if (!a || !b || !prefers(i, j)) continue;
        if (a.points >= b.points) continue;
        if (!eligible(slots[i], b.positions) || !eligible(slots[j], a.positions)) continue;

        filled[i] = b;
        filled[j] = a;
        swapped = true;
      }
    }

    if (!swapped) return;
  }
}

/** Sum of a lineup's points, rounded once at the end. */
function total(lineup: readonly LineupSlot[]): number {
  return round(lineup.reduce((sum, s) => sum + s.points, 0));
}

/**
 * The best lineup reachable from the one already set: every slot held by a
 * locked player stays exactly as it is, and the rest are solved from the players
 * who can still be moved.
 *
 * With nothing locked this is `optimalLineup` over the whole roster, which is
 * why the horizon callers see no change at all. With something locked it is
 * still one solve rather than a slot-by-slot fill — the matroid argument on
 * {@link optimalLineup} holds over any subset of the slots, so handing it the
 * free ones and the movable players gives the best completion of what is left.
 *
 * The result is re-seated in the original slot order, because a caller reading
 * `optimal` beside `current` is reading them index by index.
 */
function solveAround(
  slots: readonly string[],
  current: readonly LineupSlot[],
  players: readonly RosterPlayer[],
  locked?: ReadonlySet<string>,
): LineupSlot[] {
  if (!locked || locked.size === 0) return optimalLineup(slots, players);

  // `current` is built by walking the same recognised slots in the same order,
  // so index `i` is one slot in both. An empty slot holds no id and is never
  // held — `locked` cannot contain the empty string, since a candidate with no
  // id never reaches the pool.
  const held = slots.map((_, i) => locked.has(current[i]?.player_id ?? ""));

  const free = slots.filter((_, i) => !held[i]);
  const movable = players.filter((player) => !locked.has(player.player_id));
  const solved = optimalLineup(free, movable);

  let next = 0;
  return slots.map((slot, i) =>
    held[i] ? current[i] : (solved[next++] ?? { slot, player_id: null, points: 0 }),
  );
}

/**
 * What this roster is starting versus what it should be.
 *
 * `starters` is Sleeper's array, which lines up with the starting slots of
 * `rosterPositions` by index; `"0"` marks an empty slot. Unknown slots are
 * dropped from both sides so the two stay comparable, and named in
 * `unknown_slots`.
 *
 * A player in `starters` who isn't in `players` scores zero rather than being
 * dropped — that is a player whose projection is missing, and silently removing
 * them from the current lineup would overstate what the roster is scoring.
 *
 * **`locked` is what makes this answerable part-way through a week.** A player
 * whose game has been played is still in the lineup and still scoring, but he is
 * no longer a *choice* — so the slot he occupies is held as it stands and he is
 * kept out of the pool for every other slot. Both halves are needed and each
 * fails on its own: leave the slot open and the optimiser seats somebody who
 * hasn't played over a player who is already scoring, and leave him in the pool
 * and it can move him somewhere he can no longer be moved. What is left is the
 * only honest reading of the difference — the best lineup reachable *from here*
 * — so `points_left` names points a manager can still go and get. Omitted, every
 * slot is free, which is the rest-of-season question and the reading the horizon
 * callers want.
 */
export function compareLineup({
  rosterPositions,
  starters,
  players,
  locked,
}: {
  rosterPositions: readonly string[];
  starters: readonly string[];
  players: readonly RosterPlayer[];
  /** Players whose games have been played — see the note above. */
  locked?: ReadonlySet<string>;
}): LineupComparison {
  const slots = startingSlots(rosterPositions);
  const known = recognisedSlots(rosterPositions);
  const unknown = [...new Set(slots.filter((slot) => !(slot in SLOT_POSITIONS)))];

  const byId = new Map(players.map((p) => [p.player_id, p]));

  // Walk every starting slot, keeping only the recognised ones, so a slot this
  // code doesn't know drops the same index from `starters` too.
  const current: LineupSlot[] = [];
  slots.forEach((slot, i) => {
    if (!(slot in SLOT_POSITIONS)) return;
    const id = starters[i];
    const player_id = id && id !== "0" ? id : null;
    current.push({
      slot,
      player_id,
      points: (player_id && byId.get(player_id)?.points) || 0,
    });
  });

  const optimal = solveAround(known, current, players, locked);

  const startingNow = new Set(current.map((s) => s.player_id).filter(Boolean));
  const startingBest = new Set(optimal.map((s) => s.player_id).filter(Boolean));

  const optimalPoints = total(optimal);
  const currentPoints = total(current);

  return {
    optimal,
    current,
    optimal_points: optimalPoints,
    current_points: currentPoints,
    // Never negative: the optimal lineup is by construction at least as good, and
    // a rounding artefact showing -0.01 would read as a bug in the advice.
    points_left: Math.max(0, round(optimalPoints - currentPoints)),
    start: [...startingBest].filter((id) => !startingNow.has(id)) as string[],
    sit: [...startingNow].filter((id) => !startingBest.has(id)) as string[],
    unknown_slots: unknown,
  };
}
