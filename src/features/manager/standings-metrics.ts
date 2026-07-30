import { formatPoints, formatValue } from "./format.ts";
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
 * Team-specific by design: every metric here is one team's aggregate — read off
 * its standings row, its {@link TeamOutlook}, or its roster's total on the KTC and
 * ADP boards. The roster panel beside it carries the *per-player* KTC and ADP
 * value; here those two lenses are the whole roster summed to one number. Only the
 * total, never a rank: the standings has no rank cell (unlike the collapsed card),
 * so a manager's column is always a plain value.
 *
 * Pure and free of runtime imports beyond {@link formatPoints} and {@link
 * formatValue} — everything from {@link ./types} arrives as an erased `import
 * type` — so the accessors read and test without a fetch behind them, the same bar
 * `league-metrics` holds.
 */

/** What a team metric reads from: one team's standings row, outlook and board totals. */
export type TeamMetricContext = {
  team: LeagueTeamView;
  /** This team's rest-of-season outlook, or null/undefined when none was projected. */
  outlook: TeamOutlook | null | undefined;
  /** This team's KTC total on the league's board, or null when nothing is priced. */
  ktcTotal: number | null;
  /** This team's ADP-derived total, or null when nothing is priced. */
  adpTotal: number | null;
  /** Whether the league reads the superflex board — for the KTC and ADP hovers. */
  superflex: boolean;
  /** How many crawled drafts stood behind the ADP board, for its hover. */
  draftCount: number;
};

/**
 * A team's total on one of the per-player value boards: every rostered player's
 * board value summed, deduped, unpriced ids skipped.
 *
 * Null when nothing on the roster is priced — an em dash rather than a zero, the
 * reading the collapsed card's KTC total takes. A board value is always positive,
 * so a zero total only ever means an unpriced roster, which is why the priced
 * count and not the sum decides the em dash. Mirrors `rosterKtcValue` /
 * `rosterAdpValue`, which sum the same way server-side.
 */
export function rosterValueTotal(
  playerIds: readonly string[],
  values: Record<string, number>,
): number | null {
  let total = 0;
  let priced = 0;
  // Sleeper pads unfilled slots with an empty id or a literal "0"; a deduped
  // roster keeps the total from double-counting anyone.
  for (const id of new Set(playerIds)) {
    if (!id || id === "0") continue;
    const value = values[id];
    if (value === undefined) continue;
    total += value;
    priced++;
  }
  return priced > 0 ? total : null;
}

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
 * those lineups leave on the bench — the single season-long optimal lineup (a
 * different, always-smaller number, see {@link TeamOutlook}), the points the team
 * has actually scored so far, and the whole roster's value on the KTC and ADP
 * boards. The last two are totals only — no rank, since the standings has no rank
 * cell to place one in.
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
  {
    key: "ktc",
    label: "KTC",
    cell: ({ ktcTotal, superflex }) =>
      ktcTotal === null
        ? { text: null, title: "nothing on this roster is priced on KeepTradeCut" }
        : {
            text: formatValue(ktcTotal),
            title: `${formatValue(ktcTotal)} KeepTradeCut dynasty ${
              superflex ? "superflex" : "1QB"
            } value`,
          },
  },
  {
    key: "adp",
    label: "ADP",
    cell: ({ adpTotal, superflex, draftCount }) =>
      adpTotal === null
        ? { text: null, title: "no ADP value on the matching board" }
        : {
            text: formatValue(adpTotal),
            title: [
              `${formatValue(adpTotal)} draft-capital value`,
              `${superflex ? "superflex" : "1QB"} board`,
              draftCount > 0 &&
                `over ${draftCount} crawled draft${draftCount === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · "),
          },
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
