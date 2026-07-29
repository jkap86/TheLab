import type { LeaguemateView, ManagerLeague } from "./types";

/**
 * Leaguemate shares: who a manager shares leagues with, and how many.
 *
 * The same shape as `shares` with user ids where it has player ids, and pure
 * for the same reason — the counting rules are worth reading and testing
 * without a network behind them. It takes the leagues *after* filtering, so the
 * controls that narrow the league list narrow what a share is out of: the
 * people you're in dynasty leagues with and the people you redraft with are
 * different crowds.
 */

/** One leaguemate and every league of the manager's they are also in. */
export type LeaguemateShare = {
  user_id: string;
  /** Falls back to the id when the member list doesn't name them. */
  name: string;
  avatar_url: string | null;
  /** The shared leagues, in the order the league list gave them. */
  leagues: ManagerLeague[];
};

export type LeaguemateShares = {
  /**
   * Leagues that contributed a member list — the denominator of a share.
   *
   * A league whose members aren't cached is skipped rather than counted, or it
   * would quietly deflate every share in the list. One where the manager is the
   * only member does count: sharing it with nobody is a real answer.
   */
  league_count: number;
  /** Most leagues shared first, ties broken by name so the order is stable. */
  mates: LeaguemateShare[];
};

export function leaguemateShares(
  leagues: readonly ManagerLeague[],
  members: Record<string, readonly string[]>,
  users: Record<string, LeaguemateView>,
  /** The searched manager's own id — they are on every list and not a mate. */
  selfId: string,
): LeaguemateShares {
  const byMate = new Map<string, ManagerLeague[]>();
  let leagueCount = 0;

  for (const league of leagues) {
    const roster = members[league.league_id];
    if (!roster) continue;
    leagueCount++;

    for (const id of roster) {
      if (!id || id === selfId) continue;
      const shared = byMate.get(id);
      if (!shared) byMate.set(id, [league]);
      // Leagues are walked one at a time, so a repeat of the current one is a
      // duplicate id within a single member list and must not count twice.
      else if (shared[shared.length - 1] !== league) shared.push(league);
    }
  }

  const mates: LeaguemateShare[] = [];
  for (const [user_id, shared] of byMate) {
    const user = users[user_id];
    mates.push({
      user_id,
      name: user?.display_name || user_id,
      avatar_url: user?.avatar_url ?? null,
      leagues: shared,
    });
  }

  mates.sort(
    (a, b) => b.leagues.length - a.leagues.length || a.name.localeCompare(b.name),
  );

  return { league_count: leagueCount, mates };
}
