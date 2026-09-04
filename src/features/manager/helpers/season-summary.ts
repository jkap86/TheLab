import type { ManagerLeague } from "@/shared/contract";

/**
 * The three numbers the identity plate's season block reads out: how many
 * leagues, the combined record across them, and the win rate that record
 * implies.
 *
 * Taken over the **filtered** list, which reverses what this comment used to
 * say and is worth stating as a reversal. It was the unfiltered one while the
 * summary was a housing of its own standing beside the plate: it described the
 * account for the season, and the *filtered* count had a home of its own in the
 * View housing's `{matched} / {total}` readout.
 *
 * The header pass took both of those away. The summary is now engraved on the
 * identity plate itself and the View housing has moved into the rack, so there
 * is one set of figures on the page and they have to answer the question the
 * reader is actually asking — a reader who has narrowed to dynasty wants their
 * dynasty record, which is the same argument the shares drawers already count
 * by. What the unfiltered list is still needed for is the denominator beside
 * the count, and that is passed to `SeasonSummary` separately rather than being
 * derived here: this function sees one list and reports on it.
 *
 * `record` is null on a league whose rosters have not been read (see
 * `LeagueRecord`), and those leagues are skipped rather than counted as `0-0`:
 * a 6-league account with two unsynced leagues has a combined record over four,
 * and saying otherwise would move the win rate.
 */
export type SeasonSummary = {
  /** How many leagues were counted, synced or not — see the note above. */
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
