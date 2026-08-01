import { formatPoints, formatValue, weekCount } from "./format.ts";
import type { PlayerOutlook, PlayerSplit } from "./types";

/**
 * The player-level values a roster column can show, and how to read one off a
 * player's projection split and this league's KTC and ADP boards.
 *
 * The roster panel used to hard-code two columns — the projected points a player
 * gets starting and the points he leaves on the bench — but a roster is worth
 * reading through more than that one lens: what a player is worth on KeepTradeCut,
 * or off the market's average draft position, answers a trade question the
 * projection can't. So each of the two value columns is now a slot the reader
 * points at a metric of their choosing, and this is the catalogue of what a slot
 * can hold.
 *
 * Player-specific by design, the mirror of the standings catalogue's team lens:
 * every metric here is one player's number. KTC and ADP live here rather than
 * beside the manager's columns because they price a *player*, and a roster is the
 * only place that reads at the player grain.
 *
 * Pure and free of runtime imports beyond {@link formatPoints} and its siblings —
 * everything from {@link ./types} arrives as an erased `import type` — so the
 * accessors read and test without a fetch behind them, the same bar
 * `league-metrics` and `standings-metrics` hold.
 */

/** What a player metric reads from: one player's projection split and board values. */
export type PlayerMetricContext = {
  /** The player's aggregate projection over the horizon, or undefined when none. */
  outlook: PlayerOutlook | undefined;
  /** How that projection divides between weeks in and out of the lineup. */
  split: PlayerSplit | undefined;
  /** Weeks the projection covers, for marking a total that runs short of the horizon. */
  horizon: number;
  /** This player's KTC value on the league's board, or null when unpriced. */
  ktc: number | null;
  /** This player's ADP-derived draft-capital value, or null when unpriced. */
  adp: number | null;
  /** The raw average draft position behind that ADP value, for the hover. */
  adpPosition: number | null;
  /** Whether the league reads the superflex board — for the KTC and ADP hovers. */
  superflex: boolean;
  /** How many crawled drafts stood behind the ADP board, for its hover. */
  draftCount: number;
};

/**
 * One column's read for a player.
 *
 * `text` is the formatted number, or null for an em dash — the reading used
 * everywhere here, since a player with no projection and one projected to score
 * nothing are different claims. `muted` dims a real but empty number (a projected
 * 0.00, an off-board value). `short` appends the short-horizon marker, which only
 * a projection-based metric wants and only past a week's shortfall.
 */
export type PlayerMetricCell = {
  text: string | null;
  title: string;
  muted?: boolean;
  short?: boolean;
};

/** One selectable player metric: its key, its short column label, and how to read it. */
export type PlayerMetric = {
  /** Stable id, stored as a column's selection and keyed in the picker. */
  key: string;
  /** The uppercase column heading — kept short enough to sit in a number column. */
  label: string;
  /** Reads this metric off one player's context into a renderable cell. */
  cell: (ctx: PlayerMetricContext) => PlayerMetricCell;
};

/** Whether a projection covers fewer weeks than the horizon by more than a bye. */
function isShort(outlook: PlayerOutlook, horizon: number): boolean {
  return horizon - outlook.weeks > 1;
}

/**
 * Every player metric a roster column can show, in the order the picker lists
 * them: the projected split it opened with — points in the best lineup and points
 * on the bench — the season total behind that split, then the two player-value
 * lenses, KeepTradeCut dynasty value and ADP-derived draft capital.
 */
export const PLAYER_METRICS: PlayerMetric[] = [
  {
    key: "start",
    label: "Start",
    cell: ({ outlook, split, horizon }) => {
      if (!outlook) return { text: null, title: "No projection" };
      // A projected player with no split was never a lineup candidate this
      // horizon; zero is the honest reading — none of it reaches a starting slot.
      const points = split?.starting_points ?? 0;
      const weeks = split?.starting_weeks ?? 0;
      return {
        text: formatPoints(points),
        title:
          weeks === 0
            ? "Never in a week's best lineup"
            : `${formatPoints(points)} over ${weekCount(weeks)} in the best lineup`,
        short: isShort(outlook, horizon),
      };
    },
  },
  {
    key: "bench",
    label: "Bench",
    cell: ({ outlook, split }) => {
      if (!outlook) return { text: null, title: "No projection" };
      const points = split?.bench_points ?? 0;
      const weeks = split?.bench_weeks ?? 0;
      return {
        text: formatPoints(points),
        // A real 0.00 — never out of the lineup — is dimmed but printed, not an
        // em dash: it is a claim worth making, unlike a missing projection.
        muted: points === 0,
        title:
          weeks === 0
            ? "In the best lineup every week he is projected for"
            : `${formatPoints(points)} over ${weekCount(weeks)} out of the lineup`,
      };
    },
  },
  {
    key: "proj",
    label: "Proj",
    cell: ({ outlook, horizon }) => {
      if (!outlook) return { text: null, title: "No projection" };
      return {
        text: formatPoints(outlook.points),
        title: `${formatPoints(outlook.points)} projected over ${outlook.weeks} of ${weekCount(horizon)}`,
        short: isShort(outlook, horizon),
      };
    },
  },
  {
    key: "ktc",
    label: "KTC",
    cell: ({ ktc, superflex }) => {
      if (ktc === null) return { text: null, title: "not priced on KeepTradeCut" };
      return {
        text: formatValue(ktc),
        title: `${formatValue(ktc)} KeepTradeCut dynasty ${
          superflex ? "superflex" : "1QB"
        } value`,
      };
    },
  },
  {
    key: "adp",
    label: "ADP",
    cell: ({ adp, adpPosition, superflex, draftCount }) => {
      if (adp === null) return { text: null, title: "no ADP on the matching board" };
      return {
        text: formatValue(adp),
        title: [
          adpPosition !== null && `ADP ${adpPosition.toFixed(1)}`,
          `${formatValue(adp)} draft-capital value`,
          `${superflex ? "superflex" : "1QB"} board`,
          draftCount > 0 &&
            `over ${draftCount} crawled draft${draftCount === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    },
  },
];

/** The player-metric list keyed by id, for resolving a column's stored selection. */
export const PLAYER_METRICS_BY_KEY: Record<string, PlayerMetric> =
  Object.fromEntries(PLAYER_METRICS.map((metric) => [metric.key, metric]));

/**
 * The two columns a roster section opens with — the projected start/bench split it
 * showed before the slots were made selectable, so the default view is unchanged.
 */
export const DEFAULT_PLAYER_COLUMNS: string[] = ["start", "bench"];
