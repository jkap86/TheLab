import type { ManagerLeague, PlayerSummary } from "./types";

/**
 * Player shares: who a manager owns, and in how many of their leagues.
 *
 * Pure, and beside `filters` for the same reason — the counting rules are worth
 * reading and testing without a network or a database behind them. It takes the
 * leagues *after* filtering, so the same controls that narrow the league list
 * narrow what a share is out of.
 */

/** One player and every league of the manager's he is rostered in. */
export type PlayerShare = {
  player_id: string;
  /** Falls back to the id, as the roster views do, when the cache misses him. */
  name: string;
  position: string | null;
  team: string | null;
  /** The leagues holding him, in the order the league list gave them. */
  leagues: ManagerLeague[];
};

export type PlayerShares = {
  /**
   * Leagues that contributed a roster — the denominator of a share.
   *
   * Not the number of leagues shown: a league whose rosters aren't cached would
   * otherwise make every share in the list read a little lower than it is. A
   * league with an empty roster (pre-draft) does count, since holding nobody in
   * it is a real answer to "in how many of your leagues".
   */
  league_count: number;
  /** Most-owned first, ties broken by name so the order is stable. */
  players: PlayerShare[];
};

export function playerShares(
  leagues: readonly ManagerLeague[],
  rosters: Record<string, readonly string[]>,
  players: Record<string, PlayerSummary>,
): PlayerShares {
  const byPlayer = new Map<string, ManagerLeague[]>();
  let leagueCount = 0;

  for (const league of leagues) {
    const roster = rosters[league.league_id];
    if (!roster) continue;
    leagueCount++;

    for (const id of roster) {
      // Sleeper pads roster slots with an empty id or a literal "0".
      if (!id || id === "0") continue;
      const held = byPlayer.get(id);
      if (!held) byPlayer.set(id, [league]);
      // Leagues are walked one at a time, so a repeat of the current one is a
      // duplicate id within a single roster and must not count twice.
      else if (held[held.length - 1] !== league) held.push(league);
    }
  }

  const shares: PlayerShare[] = [];
  for (const [player_id, held] of byPlayer) {
    const player = players[player_id];
    shares.push({
      player_id,
      name: player?.name ?? player_id,
      position: player?.position ?? null,
      team: player?.team ?? null,
      leagues: held,
    });
  }

  shares.sort(
    (a, b) => b.leagues.length - a.leagues.length || a.name.localeCompare(b.name),
  );

  return { league_count: leagueCount, players: shares };
}
