/**
 * Optimal lineups: which rostered players should start, given a league's slots
 * and a projection for each player.
 *
 * Pure and free of runtime imports so it can be unit-tested — the caller supplies
 * the roster, the slots and the already-scored players (see `./score`).
 */

/**
 * Which fantasy positions may fill each Sleeper lineup slot.
 *
 * `FLEX` and friends are the whole reason this file isn't a sort: they overlap
 * without nesting. `WRRB_FLEX` takes RB/WR and `REC_FLEX` takes WR/TE, so neither
 * contains the other, and a league with both (there are leagues with both) can't
 * be filled correctly by handling slots one at a time — see {@link optimalLineup}.
 */
const SLOT_POSITIONS: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB"],
};

/** Slots that hold players without starting them. */
const NON_STARTING = new Set(["BN", "IR", "TAXI"]);

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
  return rosterPositions.filter((slot) => !NON_STARTING.has(slot));
}

/** Two decimals — points arrive rounded there and summing reintroduces noise. */
const round = (n: number): number => Math.round(n * 100) / 100;

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
 * How one player's projection divides between the weeks he makes that week's best
 * lineup and the weeks he doesn't.
 *
 * The two halves answer different questions and a single total answers neither.
 * For a starter, `bench_points` is what his slot is worth to somebody else on his
 * bye; for a bench player, `starting_points` is the only part of his projection
 * that ever reaches the lineup — a 60-point backup who is never the better start
 * is worth nothing, and a 60-point backup who is the better start three times is
 * worth exactly those three weeks.
 */
export type PlayerSplit = {
  /** Points in the weeks this player is in the best lineup. */
  starting_points: number;
  /** Points in the weeks he is projected but not started. */
  bench_points: number;
  /** Weeks he is in the best lineup. */
  starting_weeks: number;
  /** Weeks he is projected and left out of it. */
  bench_weeks: number;
};

/** Each week's best lineup, summed, and who the points belong to. */
export type WeeklyLineupSplit = {
  /**
   * A roster's projected points for the rest of the season: the sum of every
   * week's own best lineup.
   */
  points: number;
  /**
   * What those lineups leave behind: every projected point of every candidate who
   * didn't start, summed over the horizon.
   *
   * Depth, measured in the only unit that matters — a roster whose bench projects
   * high is either deep or logjammed, and either way it is carrying value it isn't
   * playing. Not a number to minimise: a bye week has to be covered by someone, so
   * zero here would mean a roster with nothing behind its starters.
   *
   * Counts only lineup candidates, so IR and taxi are out of it for the same
   * reason they are out of `points` — they were never eligible to start.
   */
  bench_points: number;
  /**
   * The same two totals attributed player by player, keyed by player id. Only
   * players who appear in at least one week are here.
   */
  players: Record<string, PlayerSplit>;
};

/**
 * What each week's best lineup scores, summed over the weeks given, and how those
 * points divide among the roster.
 *
 * A different question from {@link optimalLineup} run once on season-long totals,
 * and always at least as large. One lineup ranked on aggregate points answers
 * "who belongs in my starting slots from here"; this answers "what is this roster
 * going to score", where the manager is free to re-set the lineup every week — so
 * a bye costs one week rather than a slot, and two backs who take turns being the
 * better start both count.
 *
 * `weeks` holds one entry per remaining week: the same candidates, scored against
 * *that* week's projection. A player absent from a week is neither started nor
 * benched in it, which is what keeps a bye out of the counts — his slot still goes
 * to whoever is playing, because a player with no projection could only ever
 * contribute zero to the lineup he was seated in.
 *
 * `points` is rounded once at the end, for the reason `./aggregate` sums stat lines
 * rather than points: eighteen weekly roundings are eighteen chances to drift. Each
 * player's halves are rounded once for the same reason, which means summing the
 * halves across a roster can land a cent or two off `points` — they are two
 * roundings of the same number, not two different numbers.
 */
export function weeklyLineupSplit(
  slots: readonly string[],
  weeks: readonly (readonly RosterPlayer[])[],
): WeeklyLineupSplit {
  const split = new Map<string, PlayerSplit>();
  const entry = (player_id: string): PlayerSplit => {
    let found = split.get(player_id);
    if (!found) {
      split.set(
        player_id,
        (found = {
          starting_points: 0,
          bench_points: 0,
          starting_weeks: 0,
          bench_weeks: 0,
        }),
      );
    }
    return found;
  };

  let sum = 0;
  let benched = 0;
  for (const players of weeks) {
    const started = new Set<string>();
    for (const slot of optimalLineup(slots, players)) {
      sum += slot.points;
      if (slot.player_id) started.add(slot.player_id);
    }

    for (const player of players) {
      const found = entry(player.player_id);
      if (started.has(player.player_id)) {
        found.starting_points += player.points;
        found.starting_weeks += 1;
      } else {
        found.bench_points += player.points;
        found.bench_weeks += 1;
        benched += player.points;
      }
    }
  }

  for (const found of split.values()) {
    found.starting_points = round(found.starting_points);
    found.bench_points = round(found.bench_points);
  }

  return {
    points: round(sum),
    // Summed alongside the per-player halves rather than from them, so the team
    // total rounds once off the raw weeks instead of accumulating a cent of drift
    // per player the way adding up the rendered column would.
    bench_points: round(benched),
    players: Object.fromEntries(split),
  };
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
 */
export function compareLineup({
  rosterPositions,
  starters,
  players,
}: {
  rosterPositions: readonly string[];
  starters: readonly string[];
  players: readonly RosterPlayer[];
}): LineupComparison {
  const slots = startingSlots(rosterPositions);
  const known = slots.filter((slot) => slot in SLOT_POSITIONS);
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

  const optimal = optimalLineup(known, players);

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
