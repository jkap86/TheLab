import type { LineupCheckLeague } from "@/shared/contract";

/**
 * A week's record in one league, a game per opponent the league schedules.
 *
 * Sleeper's median matchup (`settings.league_average_match`) pairs every team
 * against the league's median as well as against an opponent, so a league
 * that runs one plays **two** games a week and its record for the week is
 * `2–0`, `1–1` or `0–2` — which is what Sleeper writes into its standings, and
 * what a reader of that league counts. This is that rule spelled once: the
 * card's plate and the page's projected record both read it, so a league that
 * is `2–0` on its own card cannot contribute `1–0` to the plate above it.
 *
 * **The head-to-head gates the record even where a median exists.** A future
 * week has no stored matchup rows by construction, and `opponent_points` is
 * null for that, for a week Sleeper filed without a pairing, and for an
 * opponent whose roster is not stored — three absences, no result. The median
 * is solved off *live* rosters, so it can answer for a week nobody has been
 * scheduled for; counting it alone would put a projected 0–13 on the plate in
 * August, one median league at a time. Null, on the card's own rule for the
 * plate it draws.
 *
 * A dead heat is a tie on either game, and it is a real answer: two lineups
 * projecting to the hundredth is vanishingly rare, and folding it into a loss
 * would be a claim.
 */
export type LeagueWeekRecord = {
  wins: number;
  losses: number;
  ties: number;
  /** `wins + losses + ties` — two where the league runs a median, else one. */
  games: number;
  /** Whether the second game — the one against the league's median — counted. */
  median: boolean;
};

export function leagueWeekRecord(
  entry: LineupCheckLeague | null | undefined,
): LeagueWeekRecord | null {
  if (!entry || entry.opponent_points === null) return null;

  const record = { wins: 0, losses: 0, ties: 0 };
  tally(record, entry.current_points, entry.opponent_points);
  const median = entry.median_points !== null;
  if (median) tally(record, entry.current_points, entry.median_points as number);

  return {
    ...record,
    games: record.wins + record.losses + record.ties,
    median,
  };
}

function tally(
  record: { wins: number; losses: number; ties: number },
  mine: number,
  against: number,
): void {
  if (mine > against) record.wins++;
  else if (mine < against) record.losses++;
  else record.ties++;
}

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
 * **It counts games, not leagues**, and the two differ exactly where a league
 * runs a median matchup: that league is two results for the week, on its own
 * card and in Sleeper's own standings, and a plate that counted it once would
 * read `1–0` beside a card reading `2–0` — the same week, two answers. The
 * fold is {@link leagueWeekRecord}, so the card and this plate cannot count a
 * league differently. `leagues` still says how many leagues those games came
 * from, because the denominator a reader compares against the page's league
 * count is that one.
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
  /** Leagues that had an opponent to be projected against. */
  leagues: number;
  /** Games projected — one per league, two where the league runs a median. */
  games: number;
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
  let projected = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const league of leagues) {
    // Both absences are the same absence here: a league the check has not
    // answered for, and a week with no opponent to answer against.
    const record = leagueWeekRecord(checked[league.league_id]);
    if (!record) continue;
    projected++;
    wins += record.wins;
    losses += record.losses;
    ties += record.ties;
  }

  const games = wins + losses + ties;
  return {
    leagues: projected,
    games,
    wins,
    losses,
    ties,
    winPct: games > 0 ? ((wins + ties / 2) / games) * 100 : null,
  };
}

/** `8–5`, or `8–5–1` where a projection landed on a dead heat. */
export function formatRecord(record: {
  wins: number;
  losses: number;
  ties: number;
}): string {
  const base = `${record.wins}–${record.losses}`;
  return record.ties > 0 ? `${base}–${record.ties}` : base;
}

/** The page's record, or an em dash where no game was projected. */
export function formatProjectedRecord(summary: WeekSummary): string {
  return summary.games === 0 ? "—" : formatRecord(summary);
}

/** `50.0%`, or an em dash where there is nothing to divide. */
export function formatProjectedWinPct(summary: WeekSummary): string {
  return summary.winPct === null ? "—" : `${summary.winPct.toFixed(1)}%`;
}
