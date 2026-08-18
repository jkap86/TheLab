import { PLAYER_METRICS_BY_KEY } from "./roster-metrics.ts";
import { TEAM_METRICS_BY_KEY } from "./standings-metrics.ts";

/**
 * Which of the League Details panel's three enrichment reads anything on screen
 * actually needs.
 *
 * The panel is four queries — the structural core, and `values`, `outlook` and
 * `week` beside it (see `use-league-detail`). Splitting them stopped the panel
 * *waiting* on all four; it did not stop it *asking* for them. Every open ran the
 * KTC/ADP pricing and the rest-of-season lineup solve whatever the two tables
 * were pointed at, so a lineup checker opened on one Sunday paid for a
 * season-long solve per team it never drew, and a season panel showing its two
 * default projection columns paid for a board it never priced anything against.
 * Both are the leagues list's own {@link managerDataRequirements} problem read
 * one grain down, and this is the same answer.
 *
 * Pure, and the mapping from a stored selection to a set of requests is the whole
 * of it — which is the point of extracting it, since getting it wrong is silent
 * in *both* directions. Over-declared, the panel fetches a lineup solve nothing
 * draws. Under-declared, a column the reader has selected sits at an em dash
 * because nothing asked for its data, which reads as "nothing priced" rather than
 * as "not fetched".
 */

/**
 * One of the panel's three enrichment reads, as a metric names what it costs.
 *
 * It lives here rather than in either catalogue because *both* catalogues
 * declare it — the standings' team metrics and the roster's player metrics are
 * two lists over one set of requests — and a union defined in one of them would
 * make the other import a module that is about neither. The catalogues take it
 * back as an erased `import type`, so nothing about that direction exists at
 * runtime.
 */
export type LeagueDataset = "values" | "outlook" | "week";

/** Which of the panel's three enrichment reads to make. */
export type LeagueDetailNeeds = Record<LeagueDataset, boolean>;

/**
 * The three requests a panel's current view actually needs.
 *
 * Two of the three are derived from the column selections and one is not, and
 * which is which is the whole judgement here:
 *
 * - **`values` is column-driven and nothing else.** The KTC and ADP numbers
 *   reach the screen through the two catalogues' `ktc`/`adp` metrics and through
 *   the footnote naming the board under them, which is itself drawn only while
 *   one of those columns is selected. Nothing structural on the panel reads a
 *   price, so a board of projection columns has no business fetching one.
 *
 * - **`week` is the panel's own subject.** A `week` is what the lineup checker
 *   passes and what the leagues list and the trades board do not, and on the
 *   panel that has one the whole reading is that payload's: the lineup each half
 *   lists, the start/sit marks on it, the kickoff each row names, the median bar
 *   in the head. So it is asked for whenever there is a week to ask about, and
 *   never otherwise — which is also why a `week_proj` column aimed at a *season*
 *   panel asks for nothing. There is no week for it to be about, and its cell
 *   says exactly that.
 *
 * - **`outlook` is both.** On a season panel it is structural in the same way
 *   the week payload is on a week one: the roster halves list `optimal` as their
 *   starters, the bench under it is ordered on the season's projected points, the
 *   standings rows are ranked by `weekly_optimal_points`, and the two caveats
 *   under the tables are read off it. None of that is a column. On a *week* panel
 *   every one of those readings comes off the week instead, so there it falls
 *   back to being column-driven — which is the case this function exists for.
 *
 * A key naming no metric — a selection stored by an older build — requires
 * nothing, which is `resolveColumns`' per-slot fallback arriving here as well: a
 * slot that cannot be drawn should not be a slot that fetches.
 */
export function leagueDetailNeeds({
  week,
  teamColumns,
  playerColumns,
}: {
  /** The week this panel was opened on, or null for the season reading. */
  week: number | null;
  /** The standings' selected metric keys — see `DEFAULT_TEAM_COLUMNS`. */
  teamColumns: readonly string[];
  /** The roster halves' selected metric keys — see `DEFAULT_PLAYER_COLUMNS`. */
  playerColumns: readonly string[];
}): LeagueDetailNeeds {
  const selected = new Set<LeagueDataset>();
  for (const key of teamColumns) {
    for (const dataset of TEAM_METRICS_BY_KEY[key]?.reads ?? []) {
      selected.add(dataset);
    }
  }
  for (const key of playerColumns) {
    for (const dataset of PLAYER_METRICS_BY_KEY[key]?.reads ?? []) {
      selected.add(dataset);
    }
  }

  return {
    values: selected.has("values"),
    outlook: week === null || selected.has("outlook"),
    // Deliberately not `selected.has("week")`: the week is the panel's subject
    // rather than one of its columns, so a panel with one always asks and a panel
    // without one has nothing to ask about however its slots are aimed.
    week: week !== null,
  };
}
