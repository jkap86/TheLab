import { formatPoints } from "./format.ts";
import type { LeagueTeamView, TeamOutlook } from "./types";

/**
 * The team-level values a standings column can show, and how to read one off a
 * team's row and its rest-of-season outlook.
 *
 * The expanded panel's standings used to hard-code two columns — projected
 * points and projected bench — but the same two teams are worth comparing on more
 * than that pair: what a single season-long lineup projects, or the points they
 * have actually scored. So each of the two value columns is now a slot the reader
 * points at a metric of their choosing, and this is the catalogue of what a slot
 * can hold.
 *
 * Team-specific by design: every metric here is one team's aggregate, read off
 * its standings row or its {@link TeamOutlook}. The roster panel beside it has the
 * player-level lens (a player's KTC and ADP value); a manager's column stays about
 * the team, which is the split the two catalogues keep.
 *
 * Pure and free of runtime imports beyond {@link formatPoints} — everything from
 * {@link ./types} arrives as an erased `import type` — so the accessors read and
 * test without a fetch behind them, the same bar `league-metrics` holds.
 */

/** What a team metric reads from: one team's standings row and its outlook. */
export type TeamMetricContext = {
  team: LeagueTeamView;
  /** This team's rest-of-season outlook, or null/undefined when none was projected. */
  outlook: TeamOutlook | null | undefined;
};

/**
 * One column's read: the formatted number to print, or null for an em dash when
 * the metric has no answer (a league with nothing projected). The hover travels
 * with it, so a metric owns everything its column needs.
 */
export type TeamMetricCell = { text: string | null; title: string };

/** One selectable team metric: its key, its short column label, and how to read it. */
export type TeamMetric = {
  /** Stable id, stored as a column's selection and keyed in the picker. */
  key: string;
  /** The uppercase column heading — kept short enough to sit in a stat column. */
  label: string;
  /** Reads this metric off one team's context into a renderable cell. */
  cell: (ctx: TeamMetricContext) => TeamMetricCell;
};

/** The em-dash cell a projection-based metric returns when the league has no outlook. */
const noProjection: TeamMetricCell = { text: null, title: "No projection" };

/**
 * Every team metric a standings column can show, in the order the picker lists
 * them: the two projected totals it opened with — each week's best lineup and what
 * those lineups leave on the bench — then the single season-long optimal lineup
 * (a different, always-smaller number, see {@link TeamOutlook}), and the points
 * the team has actually scored so far.
 */
export const TEAM_METRICS: TeamMetric[] = [
  {
    key: "proj",
    label: "Proj",
    cell: ({ outlook }) =>
      outlook
        ? {
            text: formatPoints(outlook.weekly_optimal_points),
            title: `${formatPoints(
              outlook.weekly_optimal_points,
            )} projected, setting the best lineup each week`,
          }
        : noProjection,
  },
  {
    key: "bench",
    label: "Bench",
    cell: ({ outlook }) =>
      outlook
        ? {
            text: formatPoints(outlook.weekly_bench_points),
            title: `${formatPoints(
              outlook.weekly_bench_points,
            )} projected for players those lineups never start`,
          }
        : noProjection,
  },
  {
    key: "optimal",
    label: "Optimal",
    cell: ({ outlook }) =>
      outlook
        ? {
            text: formatPoints(outlook.optimal_points),
            title: `${formatPoints(
              outlook.optimal_points,
            )} — one best lineup ranked over the whole horizon, not re-set each week`,
          }
        : noProjection,
  },
  {
    key: "pf",
    label: "PF",
    cell: ({ team }) => ({
      text: formatPoints(team.fpts),
      title: `${formatPoints(team.fpts)} points for`,
    }),
  },
];

/** The team-metric list keyed by id, for resolving a column's stored selection. */
export const TEAM_METRICS_BY_KEY: Record<string, TeamMetric> =
  Object.fromEntries(TEAM_METRICS.map((metric) => [metric.key, metric]));

/**
 * The two columns the standings opens with — projected points and projected
 * bench, the pair it showed before the slots were made selectable, so the default
 * view is unchanged.
 */
export const DEFAULT_TEAM_COLUMNS: string[] = ["proj", "bench"];
