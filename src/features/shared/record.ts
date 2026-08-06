import type { ManagerLeague } from "@/shared/manager";

/**
 * A manager's season across several leagues at once.
 *
 * Kept apart from the header that renders it, beside {@link shares} and
 * {@link filters}, because the rule that decides what the record is out of is
 * worth reading and testing on its own — see {@link aggregateRecord}.
 *
 * It is in `features/shared` because a second tool renders one: the lineup
 * checker's plate carries the record it is *projected* to finish the week with,
 * which is a different aggregation of the same shape — and both are drawn by the
 * same header, which moved here with it. `features/manager/record.ts` re-exports
 * it from where that tool's own consumers already read it.
 */
export type OverallRecord = {
  wins: number;
  losses: number;
  ties: number;
  /** Games behind the record — the denominator {@link OverallRecord.pct} uses. */
  games: number;
  /** How many leagues contributed a record, which is not how many were passed. */
  leagues: number;
  /** `(W + T/2) / G`, or null when nothing has been played. */
  pct: number | null;
};

export const EMPTY_RECORD: OverallRecord = {
  wins: 0,
  losses: 0,
  ties: 0,
  games: 0,
  leagues: 0,
  pct: null,
};

/**
 * Sum a manager's record across the leagues given — the filtered list, so the
 * header's number answers "how am I doing in *these* leagues" and moves when the
 * filters do.
 *
 * Two rules the callers must not re-derive:
 *
 * - **Counted over leagues that carry a record, not leagues listed.** Sleeper
 *   keeps a manager in `league_users` after they stop holding a team, so a
 *   league they're a member of without a roster arrives with `record: null`. The
 *   same trap as a player share, and the reason `leagues` ships with the total:
 *   it is the denominator a reader needs to judge the number, and it is smaller
 *   than the list.
 * - **A pct of `.000` and no games are different answers.** Preseason every
 *   record is `0-0-0`, and a win percentage of zero there is a claim about a
 *   season that hasn't happened. `pct` is null in that case rather than 0, so
 *   the header can say so instead of printing a loss.
 */
export function aggregateRecord(
  leagues: readonly ManagerLeague[],
): OverallRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let counted = 0;

  for (const league of leagues) {
    if (!league.record) continue;
    counted++;
    wins += league.record.wins;
    losses += league.record.losses;
    ties += league.record.ties;
  }

  const games = wins + losses + ties;
  return {
    wins,
    losses,
    ties,
    games,
    leagues: counted,
    pct: games > 0 ? (wins + ties / 2) / games : null,
  };
}
