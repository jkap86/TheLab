import type { LineupCheckLeague } from "@/shared/contract";

/**
 * The week's projected record over the leagues on screen, and the win rate it
 * implies — the two figures the identity plate reads out.
 *
 * `features/manager/helpers/season-summary.ts` with a week's figures in place
 * of a season's, and deliberately the same shape: the plate that draws them is
 * the same plate, the dial is the same dial, and two spellings of "wins as a
 * share of games, ties counted as half" would be two chances for the two pages
 * to disagree about the same arithmetic.
 *
 * **A league with no opponent is excluded, never counted as a loss.** A future
 * week has no stored matchup rows by construction, and `opponent_points` is
 * null for that, for a week Sleeper filed without a pairing, and for an
 * opponent whose roster is not stored — three absences, no result. Counting
 * them would put a projected 0–13 on a plate in August.
 *
 * `winPct` is null rather than zero where nothing is projected, on
 * `seasonSummary`'s own terms: a zero-length arc parked at the top of the dial
 * claims every game was lost, where an empty track and an em dash claim
 * nothing. Pure, so it tests under Node's runner with no render behind it.
 */
export type WeekSummary = {
  /** Leagues that had an opponent to be projected against — the denominator. */
  leagues: number;
  wins: number;
  losses: number;
  ties: number;
  /** Wins as a share of games, ties as half a win, or null with nothing to divide. */
  winPct: number | null;
};

export function weekSummary(
  leagues: readonly { league_id: string }[],
  checked: Readonly<Record<string, LineupCheckLeague>>,
): WeekSummary {
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const league of leagues) {
    const entry = checked[league.league_id];
    // Both absences are the same absence here: a league the check has not
    // answered for, and a week with no opponent to answer against.
    if (!entry || entry.opponent_points === null) continue;
    if (entry.current_points > entry.opponent_points) wins++;
    else if (entry.current_points < entry.opponent_points) losses++;
    else ties++;
  }

  const games = wins + losses + ties;
  return {
    leagues: games,
    wins,
    losses,
    ties,
    winPct: games > 0 ? ((wins + ties / 2) / games) * 100 : null,
  };
}

/** `8–5`, or `8–5–1` where a projection landed on a dead heat. */
export function formatProjectedRecord(summary: WeekSummary): string {
  if (summary.leagues === 0) return "—";
  const base = `${summary.wins}–${summary.losses}`;
  return summary.ties > 0 ? `${base}–${summary.ties}` : base;
}

/** `50.0%`, or an em dash where there is nothing to divide. */
export function formatProjectedWinPct(summary: WeekSummary): string {
  return summary.winPct === null ? "—" : `${summary.winPct.toFixed(1)}%`;
}
