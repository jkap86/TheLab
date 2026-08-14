import type { PlayerSummary } from "@/shared/players";

/**
 * Laying out a reconstructed roster for reading.
 *
 * A rewound roster arrives as what it is stored as — an unordered list of player
 * ids — and a dynasty roster is thirty to fifty of them. Printed in that order it
 * is a wall nobody reads, so the one job here is turning it into the shape every
 * fantasy roster has been written in for thirty years: grouped by position, in
 * the order a lineup is filled.
 *
 * **It was `features/trades/roster-before` and moved whole**, the mover's rule:
 * the timeline that reads it is drawn on the leagues list too, and it was never
 * about trades in the first place — a list of player ids is a list of player ids
 * whichever walk produced it. No shim was left behind, because the view that
 * imported it moved in the same step and nothing else ever did.
 *
 * Pure and free of runtime imports, so it tests like its neighbours here —
 * `PlayerSummary` arrives as an erased `import type`.
 */

/**
 * Positions in lineup order, which is **not** alphabetical and not the order the
 * ids arrive in.
 *
 * Offense first in the order a lineup fills, then the team unit, then IDP. A
 * reader scanning "what did this team have at receiver" is scanning for a
 * position, and a fixed order is what lets them scan the same distance down every
 * side of every card rather than re-reading the labels each time.
 */
const POSITION_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
  "DL",
  "DE",
  "DT",
  "LB",
  "DB",
  "CB",
  "S",
] as const;

const POSITION_RANK = new Map<string, number>(
  POSITION_ORDER.map((p, i) => [p, i]),
);

/**
 * The label a player with no position on file is filed under.
 *
 * **A group rather than an omission**, the house rule that absent is not zero: he
 * was on the roster, and the players cache not knowing him is a fact about the
 * cache. Dropping him would quietly shorten a count a reader is using to judge
 * how deep the team was.
 */
export const UNKNOWN_POSITION = "—";

/** One position's worth of a roster. */
export type RosterPositionGroup = {
  /** `QB`, `WR`, … or {@link UNKNOWN_POSITION}. */
  position: string;
  players: RosterPlayer[];
};

/** A held player, named as far as the players cache can name him. */
export type RosterPlayer = {
  player_id: string;
  /**
   * His name, or his id where nothing is on file.
   *
   * The id is a poor label and a truthful one — it is what the roster says — and
   * it is what the trade card's own asset lines already fall back to, so an
   * unresolved player reads the same on both halves of the card.
   */
  name: string;
  team: string | null;
};

/**
 * A snapshot's player ids as groups, in lineup order.
 *
 * Within a group players are ordered by name, which is the only ordering
 * available: a snapshot carries no depth chart, and ordering by id would be
 * ordering by when Sleeper happened to create the player. An unresolved player
 * sorts by his id under the same comparison, which puts him with the other
 * unresolved ones at the end of {@link UNKNOWN_POSITION} rather than scattered.
 *
 * Groups a roster has nobody in are absent rather than empty — a team with no
 * kicker has no kicker row, which is the honest reading and the compact one.
 */
export function groupRosterByPosition(
  playerIds: readonly string[],
  players: Readonly<Record<string, PlayerSummary>>,
): RosterPositionGroup[] {
  const byPosition = new Map<string, RosterPlayer[]>();

  for (const id of playerIds) {
    const summary = players[id];
    const position = summary?.position || UNKNOWN_POSITION;
    let group = byPosition.get(position);
    if (!group) byPosition.set(position, (group = []));
    group.push({
      player_id: id,
      name: summary?.name || id,
      team: summary?.team ?? null,
    });
  }

  for (const group of byPosition.values()) {
    group.sort((a, b) => a.name.localeCompare(b.name));
  }

  return [...byPosition.entries()]
    .map(([position, group]) => ({ position, players: group }))
    .sort((a, b) => comparePositions(a.position, b.position));
}

/**
 * Lineup order, with anything unranked after it.
 *
 * A position this table has never heard of is sorted alphabetically among the
 * other unranked ones rather than dropped or forced to the front — the same
 * reading `UNKNOWN_POSITION` takes of a missing one, applied to a spelling
 * Sleeper may add after this was written.
 */
function comparePositions(a: string, b: string): number {
  const rankA = POSITION_RANK.get(a);
  const rankB = POSITION_RANK.get(b);
  if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
  if (rankA !== undefined) return -1;
  if (rankB !== undefined) return 1;
  // Both unranked. The unknown group is last of all, since it is the one whose
  // membership says nothing about the roster's shape.
  if (a === UNKNOWN_POSITION) return 1;
  if (b === UNKNOWN_POSITION) return -1;
  return a.localeCompare(b);
}
