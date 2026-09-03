import type { LineupCheckLeague } from "@/shared/contract";

/**
 * How a league's week reads on the two tiles the card carries.
 *
 * Pure, and the contract arrives as an erased `import type`, so this tests
 * under Node's runner without a render behind it — the bar
 * `features/manager/helpers/lineup-metrics.ts` holds, and the reason the
 * grammar below is testable at all.
 *
 * **The grammar is three-way, and it is the whole readability of the page.**
 * Every tile says one of three things:
 *
 * - a **number, in the alert tone** — there is something to go and do;
 * - a **word** — a real and good zero (`Set`, `In order`), which is an answer
 *   and not an absence;
 * - an **em dash** — no answer at all.
 *
 * A zero and an absence must never render the same. That is what the whole
 * contract is written to — `points_left: 0` beside `kickoff_moves: null` is a
 * lineup that is optimal in a league whose seat order cannot be known — and a
 * tile that printed `0` for both would quietly claim the second was checked.
 */

/** One tile's reading. */
export type MetricCell = {
  /** The figure or word to print. */
  text: string;
  /** Whether it names something the reader can act on. */
  alert: boolean;
  /** The hover and screen-reader gloss, which is where the units live. */
  title: string;
};

/** Points to one decimal — the granularity Sleeper's projections carry. */
const points = (n: number): string => n.toFixed(1);

/** What every tile prints where the league could not be projected at all. */
const NO_ANSWER: MetricCell = {
  text: "—",
  alert: false,
  title: "No projection for this week",
};

/**
 * What this lineup is leaving on the bench.
 *
 * Read off `points_left` rather than by subtracting the two totals: the server
 * has already decided whether the lineup is optimal, and a second subtraction
 * on the client is a second chance to land a hair either side of zero and print
 * `-0.0` under a lineup that is already the best available.
 *
 * Negative on purpose where there is a gap — it is a debt, not a bonus, and a
 * bare `6.6` in a column headed "vs optimal" reads as the good direction.
 */
export function gapCell(league: LineupCheckLeague | null | undefined): MetricCell {
  if (!league) return NO_ANSWER;

  const starting = points(league.current_points);
  if (league.best_ball) {
    // Sleeper seats this lineup itself, after the games. There is no gap to
    // report because there is no lineup anybody sets.
    return {
      text: "Best ball",
      alert: false,
      title: `Starting ${starting} — Sleeper seats a best-ball lineup itself, so there is nothing to move`,
    };
  }
  if (league.points_left === 0) {
    return {
      text: "Set",
      alert: false,
      title: `Starting ${starting}, which is the best lineup still reachable`,
    };
  }
  return {
    text: `−${points(league.points_left)}`,
    alert: true,
    title:
      `Starting ${starting} against ${points(league.optimal_points)} still reachable — ` +
      `${points(league.points_left)} to be had by moving somebody`,
  };
}

/**
 * Whether the starters are seated in the order they lock best in.
 *
 * `null` is the case worth being careful about: it is *no answer* — a best-ball
 * league, or a week the schedule publishes no kickoff instants for — and never
 * "already in order". Zero really is in order, and says so in words.
 */
export function kickoffCell(
  league: LineupCheckLeague | null | undefined,
): MetricCell {
  if (!league) return NO_ANSWER;

  const moves = league.kickoff_moves;
  if (moves === null) {
    return {
      ...NO_ANSWER,
      title: league.best_ball
        ? "No seat order to set — Sleeper seats a best-ball lineup after the games"
        : "No kickoff order for this week — Sleeper has published no kickoff times",
    };
  }
  if (moves === 0) {
    return {
      text: "In order",
      alert: false,
      title:
        "Every starter is already seated for kickoff — strict slots lock first, " +
        "the flexes stay open longest. Games within an hour of each other count as one kickoff",
    };
  }
  return {
    text: `${moves} to move`,
    alert: true,
    title:
      `${moves} starter${moves === 1 ? "" : "s"} could trade seats so the flexes lock last — ` +
      "open the league for the moves",
  };
}

/**
 * A kickoff as a short local time, or null where there is none to show.
 *
 * The reader's own zone deliberately: this is the one number on the page they
 * check against a clock on the wall, and an ET time on a Pacific afternoon is a
 * lineup set an hour late.
 */
export function kickoffTime(at: number | null): string | null {
  if (at === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

/**
 * How many of these leagues have something to act on — the one figure the
 * console's summary housing shows.
 *
 * Counted over leagues rather than over points or seats, because that is the
 * question the page answers: how many of your lineups want a press. A league
 * with both a gap and a re-seat is one league.
 */
export function needsAttention(
  leagues: readonly { league_id: string }[],
  checked: Readonly<Record<string, LineupCheckLeague>>,
): number {
  let count = 0;
  for (const league of leagues) {
    const entry = checked[league.league_id];
    if (!entry) continue;
    if (entry.points_left > 0 || (entry.kickoff_moves ?? 0) > 0) count++;
  }
  return count;
}
