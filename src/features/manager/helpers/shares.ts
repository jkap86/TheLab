import type { ManagerLeague, PlayerSummary } from "@/shared/contract";

/**
 * How many of a manager's leagues roster each player.
 *
 * **The count is folded here rather than on the server**, and that is the whole
 * reason the route ships raw rosters: the page narrows its league list five ways
 * (Type, Format, Settings, Roster slots, Scoring), and a share counted over
 * anything but the leagues in front of the reader is a different question. A
 * reader narrowed to dynasty wants dynasty shares.
 *
 * The `leagues` argument is therefore the caller's business, and there is
 * exactly one right answer for it: **the league-filtered list, before any
 * subject selection.** Counted over the selection instead, every row would
 * collapse to the row you just picked the moment you picked it, and could not be
 * widened again without clearing first — the rule `facetsQuery` already enforces
 * for the trades board's own menus.
 */

/** One player, and every league of the manager's holding him. */
export type PlayerShare = {
  player_id: string;
  /** The stored name, else the id — a searchable token beats a blank. */
  name: string;
  position: string | null;
  team: string | null;
  /** The leagues holding him, in the order they were given. */
  leagues: ManagerLeague[];
};

export type PlayerShares = {
  /**
   * The denominator: leagues that **contributed a roster**, not leagues on
   * screen.
   *
   * A league whose roster has never been stored is skipped rather than counted
   * as one holding nobody, so a partly-synced account reports its shares over
   * fewer leagues than the count beside it. Zeroing it would quietly deflate
   * every share on the page.
   */
  league_count: number;
  /** Most-held first, ties broken by name. */
  players: PlayerShare[];
};

/**
 * Sleeper pads roster slots with an empty string and with `"0"`. Neither is a
 * player, and counting them would put one phantom row at the top of every
 * board — held, by construction, in every league.
 */
function isPlayerId(id: string): boolean {
  return Boolean(id) && id !== "0";
}

export function playerShares(
  leagues: readonly ManagerLeague[],
  rosters: Record<string, readonly string[]>,
  players: Record<string, PlayerSummary>,
): PlayerShares {
  const held = new Map<string, ManagerLeague[]>();
  let leagueCount = 0;

  for (const league of leagues) {
    const roster = rosters[league.league_id];
    // Absent is not empty — see `league_count`.
    if (!roster) continue;
    leagueCount++;

    for (const id of roster) {
      if (!isPlayerId(id)) continue;
      const inLeagues = held.get(id);
      if (!inLeagues) held.set(id, [league]);
      // A roster naming the same id twice is one share, not two. Comparing the
      // tail is enough because a league is walked to completion before the next
      // one starts.
      else if (inLeagues[inLeagues.length - 1] !== league) inLeagues.push(league);
    }
  }

  const shares: PlayerShare[] = [];
  for (const [player_id, inLeagues] of held) {
    const summary = players[player_id];
    shares.push({
      player_id,
      name: summary?.name ?? player_id,
      position: summary?.position ?? null,
      team: summary?.team ?? null,
      leagues: inLeagues,
    });
  }

  shares.sort(
    (a, b) => b.leagues.length - a.leagues.length || a.name.localeCompare(b.name),
  );
  return { league_count: leagueCount, players: shares };
}
