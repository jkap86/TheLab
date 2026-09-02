import type { ManagerLeague } from "@/shared/contract";

/**
 * The three numbers the console's summary housing reads out: how many leagues,
 * the combined record across them, and the win rate that record implies.
 *
 * Taken over the **unfiltered** list, deliberately. The housing sits beside the
 * manager's name, above the rule, and describes the account for the season —
 * not the current selection. A filtered count already has a home: the line
 * `filterSummary` writes under the plate.
 *
 * `record` is null on a league whose rosters have not been read (see
 * `LeagueRecord`), and those leagues are skipped rather than counted as `0-0`:
 * a 6-league account with two unsynced leagues has a combined record over four,
 * and saying otherwise would move the win rate.
 */
export type SeasonSummary = {
  /** Every league on the account this season, synced or not. */
  leagues: number;
  wins: number;
  losses: number;
  ties: number;
  /** Games the record covers — the denominator the win rate is honest about. */
  games: number;
  /**
   * Wins as a share of games, ties counted as half a win, or **null when no
   * league has a record yet**. Null is what the dial draws as an empty arc and
   * an em dash; zero would draw a real 0% and claim the manager has lost every
   * game they played.
   */
  winPct: number | null;
};

export function seasonSummary(
  leagues: readonly ManagerLeague[],
): SeasonSummary {
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const league of leagues) {
    if (!league.record) continue;
    wins += league.record.wins;
    losses += league.record.losses;
    ties += league.record.ties;
  }

  const games = wins + losses + ties;

  return {
    leagues: leagues.length,
    wins,
    losses,
    ties,
    games,
    winPct: games > 0 ? ((wins + ties / 2) / games) * 100 : null,
  };
}

/** `36–36`, or `36–36–1` where any league in the set has a tie. */
export function formatCombinedRecord(summary: SeasonSummary): string {
  const base = `${summary.wins}–${summary.losses}`;
  return summary.ties > 0 ? `${base}–${summary.ties}` : base;
}

/** `50.0%`, or an em dash where there is nothing to divide. */
export function formatWinPct(summary: SeasonSummary): string {
  return summary.winPct === null ? "—" : `${summary.winPct.toFixed(1)}%`;
}
