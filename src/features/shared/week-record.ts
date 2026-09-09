/**
 * A week's record, one league at a time and summed over a page.
 *
 * The lineup checker's `helpers/week-summary` fold, lifted out when the
 * gametime page became a second reader: that page projects a week *live* and
 * this one projects it before kickoff, and both draw the same chips on the same
 * card and the same record on the same gauge. Two folds would be two chances
 * for a league that is `2–0` on one page to read `1–1` on the other over the
 * same three numbers.
 *
 * Pure, with no imports at all, so both pages' helpers read it relatively and
 * test under Node's runner.
 *
 * **A league that runs a median matchup plays two games a week**, which is
 * what Sleeper writes into its standings and what a reader of that league
 * counts. The head-to-head gates the record even where a median exists — see
 * {@link weekRecordOf} — and a dead heat is a tie and a real answer.
 */

/**
 * One of the week's games: which opponent it was against, and how it went.
 *
 * `against` is what a chip's `sr-only` sentence names. A bare `W W` announced
 * as "W W" is not a reading, and the strip's own left-to-right order — the
 * head-to-head, then the median — is the only thing on screen that says which
 * is which.
 */
export type WeekGame = {
  against: "opponent" | "median";
  result: "win" | "loss" | "tie";
};

/** A week's record in one league, a game per opponent the league schedules. */
export type LeagueWeekRecord = {
  wins: number;
  losses: number;
  ties: number;
  /**
   * The week's games in the order the card reads them: the head-to-head,
   * then the median where the league runs one. **The tally is folded out of
   * this list rather than counted beside it** — a strip reading `L W` and a
   * record reading `1–1` are two presentations of one week.
   */
  games: readonly WeekGame[];
  /** Whether the second game — the one against the league's median — counted. */
  median: boolean;
};

/** A dead heat is a tie and a real answer — folding it into a loss is a claim. */
export function outcome(mine: number, against: number): WeekGame["result"] {
  if (mine > against) return "win";
  if (mine < against) return "loss";
  return "tie";
}

/**
 * One league's week from its three figures, or null where there is no game.
 *
 * **The head-to-head gates the record even where a median exists.** A null
 * opponent is a future week, a week Sleeper filed without a pairing, or an
 * opponent whose roster is not stored — three absences, no result. The median
 * is solved off whatever rosters are stored, so it can answer for a week nobody
 * has been scheduled for; counting it alone would put a `0–13` on the plate in
 * August, one median league at a time.
 */
export function weekRecordOf(
  mine: number,
  opponent: number | null,
  median: number | null,
): LeagueWeekRecord | null {
  if (opponent === null) return null;

  const games: WeekGame[] = [{ against: "opponent", result: outcome(mine, opponent) }];
  if (median !== null) games.push({ against: "median", result: outcome(mine, median) });

  return {
    wins: games.filter((game) => game.result === "win").length,
    losses: games.filter((game) => game.result === "loss").length,
    ties: games.filter((game) => game.result === "tie").length,
    games,
    median: median !== null,
  };
}

/**
 * A page's record over the leagues on screen, and the win rate it implies.
 *
 * **It counts games, not leagues**, and the two differ exactly where a league
 * runs a median matchup: that league is two results for the week, on its own
 * card and in Sleeper's standings. `leagues` still says how many leagues those
 * games came from, because the denominator a reader compares against the
 * page's league count is that one.
 *
 * `winPct` is null rather than zero where nothing is projected: a zero-length
 * arc parked at the top of the dial claims every game was lost, where an empty
 * track and an em dash claim nothing.
 */
export type WeekRecordSummary = {
  /** Leagues that had an opponent to be scored against. */
  leagues: number;
  /** Games — one per league, two where the league runs a median. */
  games: number;
  wins: number;
  losses: number;
  ties: number;
  /** Wins as a share of games, ties as half a win, or null with nothing to divide. */
  winPct: number | null;
};

export function summariseWeekRecords(
  records: Iterable<LeagueWeekRecord | null | undefined>,
): WeekRecordSummary {
  let leagues = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const record of records) {
    if (!record) continue;
    leagues++;
    wins += record.wins;
    losses += record.losses;
    ties += record.ties;
  }

  const games = wins + losses + ties;
  return {
    leagues,
    games,
    wins,
    losses,
    ties,
    winPct: games > 0 ? ((wins + ties / 2) / games) * 100 : null,
  };
}

/** `8–5`, or `8–5–1` where a game landed on a dead heat. */
export function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  const base = `${record.wins}–${record.losses}`;
  return record.ties > 0 ? `${base}–${record.ties}` : base;
}

/** The page's record, or an em dash where no game was scored. */
export function formatWeekRecord(summary: WeekRecordSummary): string {
  return summary.games === 0 ? "—" : formatRecord(summary);
}

/** `50.0%`, or an em dash where there is nothing to divide. */
export function formatWeekWinPct(summary: WeekRecordSummary): string {
  return summary.winPct === null ? "—" : `${summary.winPct.toFixed(1)}%`;
}
