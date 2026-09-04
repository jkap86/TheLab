import type { LeaguematePayload, ManagerLeague } from "@/shared/contract";

/**
 * How many of a manager's leagues each other person is in.
 *
 * The same fold as `playerShares` over the same population rule — see that file
 * for why the counting lives on the client and which league list a caller must
 * hand it.
 *
 * Two things are this list's own. **A leaguemate is bare membership**, not a
 * rostered team: Sleeper leaves someone in `league_users` after they stop
 * holding one, and somebody chopped out of a guillotine league is still someone
 * you know. And **they are named by display name, never by team name** — a team
 * name is a nickname picked for one league, and this list exists to recognise
 * the same person *across* leagues.
 */

/** One person, and every league of the manager's they are in. */
export type LeaguemateShare = {
  user_id: string;
  /** The stored display name, else the id — `PlayerShare`'s rule. */
  name: string;
  avatar_url: string | null;
  leagues: ManagerLeague[];
};

export type LeaguemateShares = {
  /** Leagues that contributed a member list — see `PlayerShares.league_count`. */
  league_count: number;
  /** Most-shared first, ties broken by name. */
  mates: LeaguemateShare[];
};

export function leaguemateShares(
  leagues: readonly ManagerLeague[],
  members: Record<string, readonly string[]>,
  users: Record<string, LeaguematePayload>,
  selfId: string | null,
): LeaguemateShares {
  const shared = new Map<string, ManagerLeague[]>();
  let leagueCount = 0;

  for (const league of leagues) {
    const roll = members[league.league_id];
    if (!roll) continue;
    leagueCount++;

    for (const id of roll) {
      // The manager's own row rides the payload as the sentinel that separates
      // a stored league from an unstored one; it is not a leaguemate.
      if (!id || id === selfId) continue;
      const inLeagues = shared.get(id);
      if (!inLeagues) shared.set(id, [league]);
      else if (inLeagues[inLeagues.length - 1] !== league) inLeagues.push(league);
    }
  }

  const mates: LeaguemateShare[] = [];
  for (const [user_id, inLeagues] of shared) {
    const user = users[user_id];
    mates.push({
      user_id,
      name: user?.display_name ?? user_id,
      avatar_url: user?.avatar_url ?? null,
      leagues: inLeagues,
    });
  }

  mates.sort(
    (a, b) => b.leagues.length - a.leagues.length || a.name.localeCompare(b.name),
  );
  return { league_count: leagueCount, mates };
}
