import { formatPoints, formatValue, formatWeekRange } from "./format.ts";
import type { ColumnPreset, Metric } from "./metric-cell.ts";
import type {
  LeagueAdpEntry,
  LeagueKtcEntry,
  LeagueRankSet,
  ManagerLeague,
} from "./types";

/**
 * The metrics a league card can show in each of its stat columns, and how to
 * read one off a league's cached ranks and KTC value.
 *
 * The collapsed card used to hard-code four rankings across it — record, points,
 * KTC starter value, projected points — but a roster is more than where those
 * four place it: two teams level on projected starters are not the same team when
 * one carries twice the value behind its lineup. So each column is now a slot the
 * reader points at a metric of their choosing, and this is the catalogue of what
 * a slot can hold.
 *
 * Two shapes live in one list on purpose. A *rank* metric answers "where does
 * this roster sit" as `#N of M`, tinted and metered by where in its league it
 * falls; a *value* metric answers "how much" as a plain number with no league to
 * place it against (KTC bench value, the raw points total behind a rank). The
 * card renders the two differently but picks them from the same menu, so a column
 * showing a points rank and one showing bench value are one click apart.
 *
 * The **standing is not in here**, though the card shows it: it sits beside the
 * record on the row, because a record and where it places in the league are one
 * fact and reading either without the other is reading half of it. A slot
 * pointed at it would spend one of four columns restating the line above them.
 *
 * Pure and free of runtime imports beyond {@link formatPoints} and its siblings —
 * everything from {@link ./types} arrives as an erased `import type` — so the
 * accessors can be read and tested without a fetch behind them, the same bar as
 * `shares` and `filters` beside it.
 */

/** What a metric reads from: one league's cached ranks, KTC value and horizon. */
export type MetricContext = {
  league: ManagerLeague;
  ranks: LeagueRankSet | null;
  ktc: LeagueKtcEntry | null;
  /** This roster's ADP-derived value here, or null while loading / with no roster. */
  adp: LeagueAdpEntry | null;
  /** The weeks behind the projected numbers, for a hover that says what it covers. */
  weeks: number[];
  /** When the KTC values were scraped, for the KTC metrics' hover. */
  valuedAt: string | null;
};

/**
 * One selectable league metric — {@link Metric} bound to this catalogue's grain.
 *
 * The cell shapes it can return, and the reason a rank and a value render
 * differently, live with {@link MetricCell}: they are shared with the share cards'
 * catalogue, which is drawn by the same column.
 */
export type LeagueMetric = Metric<MetricContext>;

/**
 * The KTC column's hover, where the raw value, the board and the priced count
 * answer — shared by every KTC metric so the tooltip reads the same whichever of
 * them a column shows.
 */
function ktcTitle(ktc: LeagueKtcEntry | null, valuedAt: string | null): string {
  if (!ktc || ktc.priced === 0) return "nothing priced on KeepTradeCut";
  const board = ktc.superflex ? "superflex" : "1QB";
  return [
    ktc.starters_rank &&
      `#${ktc.starters_rank.rank} of ${ktc.starters_rank.of} by starter value`,
    ktc.split && `${formatValue(ktc.split.starters)} starting`,
    ktc.split && `${formatValue(ktc.split.bench)} on the bench`,
    `${formatValue(ktc.total)} KeepTradeCut dynasty ${board} value`,
    `${ktc.priced} of ${ktc.rostered} rostered players priced`,
    valuedAt && `scraped ${new Date(valuedAt).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The projected-points hover, shared by all four projected metrics — the starter
 * rank and its total, and the bench rank and its total. `basis` names which half
 * of the lineup the number counts, so the same builder reads "by projected
 * starters" or "by projected bench", and the horizon line says whether the points
 * are what each week's best lineup scores or what it leaves on the bench.
 */
function projTitle(
  proj: { rank: number; of: number; points: number } | null,
  weeks: number[],
  ranked: boolean,
  basis: "starters" | "bench",
): string {
  if (!proj) {
    return basis === "bench"
      ? "nothing projected on the bench"
      : "nothing left to project";
  }
  const horizon = `${
    basis === "bench" ? "benched each week" : "best lineup each week"
  } · ${formatWeekRange(weeks)}`;
  return ranked
    ? `#${proj.rank} of ${proj.of} by projected ${basis} · ${formatPoints(
        proj.points,
      )} · ${horizon}`
    : `${formatPoints(proj.points)} projected · ${horizon}`;
}

/**
 * The ADP-value column's hover, shared by both ADP metrics. Names the value, the
 * split, the board it was priced on and how many crawled drafts stood behind it —
 * the same "say what the number rests on" habit the KTC and projection hovers
 * keep, and the reminder that this is a consensus board, not fantasy points.
 */
function adpTitle(adp: LeagueAdpEntry | null): string {
  if (!adp || adp.priced === 0) return "no players priced from ADP";
  const board = `${adp.superflex ? "superflex" : "1QB"} ${adp.league_type}`;
  return [
    adp.starters_rank &&
      `#${adp.starters_rank.rank} of ${adp.starters_rank.of} by starter value`,
    adp.split && `${formatValue(adp.split.starters)} starting`,
    adp.split && `${formatValue(adp.split.bench)} on the bench`,
    `${formatValue(adp.total)} ADP draft-capital value`,
    `${adp.priced} of ${adp.rostered} rostered players priced`,
    `averaged over ${adp.draft_count} crawled ${board} draft${
      adp.draft_count === 1 ? "" : "s"
    }`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Every metric a stat column can show, in the order the picker lists them: the
 * rankings a card can be read on — the standing excepted, which the record line
 * states — each paired where it makes sense with the raw number
 * behind it, the projected bench beside the projected starters (depth ranked the
 * same way, since two teams level on starters aren't level when one carries twice
 * as much behind them), plus the two KTC totals a starter rank alone can't tell
 * apart.
 */
export const LEAGUE_METRICS: LeagueMetric[] = [
  {
    key: "points",
    group: "Record",
    label: "Points",
    cell: ({ ranks }) => {
      const points = ranks?.points ?? null;
      return {
        kind: "rank",
        rank: points,
        title: points
          ? `#${points.rank} of ${points.of} by points for · ${formatPoints(
              points.pointsFor,
            )} pts`
          : "no points scored yet",
      };
    },
  },
  {
    key: "points_for",
    group: "Record",
    label: "Points for",
    cell: ({ ranks }) => {
      const points = ranks?.points ?? null;
      return {
        kind: "value",
        text: points ? formatPoints(points.pointsFor) : null,
        title: points
          ? `${formatPoints(points.pointsFor)} points for`
          : "no points scored yet",
      };
    },
  },
  {
    key: "proj",
    group: "Projection",
    label: "Proj start",
    cell: ({ ranks, weeks }) => {
      const proj = ranks?.proj ?? null;
      return {
        kind: "rank",
        rank: proj,
        title: projTitle(proj, weeks, true, "starters"),
      };
    },
  },
  {
    key: "proj_pts",
    group: "Projection",
    label: "Proj pts",
    cell: ({ ranks, weeks }) => {
      const proj = ranks?.proj ?? null;
      return {
        kind: "value",
        text: proj ? formatPoints(proj.points) : null,
        title: projTitle(proj, weeks, false, "starters"),
      };
    },
  },
  {
    key: "proj_bench",
    group: "Projection",
    label: "Proj bench",
    cell: ({ ranks, weeks }) => {
      const bench = ranks?.proj_bench ?? null;
      return {
        kind: "rank",
        rank: bench,
        title: projTitle(bench, weeks, true, "bench"),
      };
    },
  },
  {
    key: "proj_bench_pts",
    group: "Projection",
    label: "Bench pts",
    cell: ({ ranks, weeks }) => {
      const bench = ranks?.proj_bench ?? null;
      return {
        kind: "value",
        text: bench ? formatPoints(bench.points) : null,
        title: projTitle(bench, weeks, false, "bench"),
      };
    },
  },
  {
    key: "ktc_start",
    group: "Dynasty value",
    label: "KTC start",
    cell: ({ ktc, valuedAt }) => ({
      kind: "rank",
      rank: ktc?.starters_rank ?? null,
      title: ktcTitle(ktc, valuedAt),
    }),
  },
  {
    key: "ktc_total",
    group: "Dynasty value",
    label: "KTC total",
    cell: ({ ktc, valuedAt }) => ({
      kind: "value",
      // A priced count of zero is a real, empty roster rather than a value of
      // zero — an em dash, not "0", the same reading the card's KTC chip takes.
      text: ktc && ktc.priced > 0 ? formatValue(ktc.total) : null,
      title: ktcTitle(ktc, valuedAt),
    }),
  },
  {
    key: "ktc_bench",
    group: "Dynasty value",
    label: "KTC bench",
    cell: ({ ktc, valuedAt }) => ({
      kind: "value",
      // `split` is null when there is no lineup to divide the value by — a league
      // with nothing left to project — so bench has no answer, not a zero.
      text: ktc?.split ? formatValue(ktc.split.bench) : null,
      title: ktcTitle(ktc, valuedAt),
    }),
  },
  {
    key: "adp_total",
    group: "Draft market",
    label: "ADP value",
    cell: ({ adp }) => ({
      kind: "value",
      // Nothing priced is a real, empty roster rather than a value of zero — an
      // em dash, the same reading the KTC total takes.
      text: adp && adp.priced > 0 ? formatValue(adp.total) : null,
      title: adpTitle(adp),
    }),
  },
  {
    key: "adp_rank",
    group: "Draft market",
    label: "ADP rank",
    cell: ({ adp }) => ({
      kind: "rank",
      rank: adp?.starters_rank ?? null,
      title: adpTitle(adp),
    }),
  },
];

/** The metric list keyed by id, for resolving a column's stored selection. */
export const LEAGUE_METRICS_BY_KEY: Record<string, LeagueMetric> =
  Object.fromEntries(LEAGUE_METRICS.map((metric) => [metric.key, metric]));

/**
 * The four columns a card opens with — one ranking from each of the four
 * questions the catalogue is grouped by, so the opening view is a cross-section
 * rather than a deep read of any one lens.
 *
 * The standing is deliberately not among them and cannot be: it is stated on the
 * card's record line, and spending a slot restating it is what taking it out of
 * the catalogue was for. A stored selection naming it falls back per slot, which
 * is `resolveColumns` doing its job rather than something to migrate.
 */
export const DEFAULT_COLUMNS: string[] = [
  "points",
  "ktc_start",
  "proj",
  "adp_rank",
];

/**
 * The boards worth a name, as the columns editor offers them.
 *
 * Each is a question rather than a theme: how is this team *doing*, what is it
 * *going* to do, what is it *worth* to a dynasty trader, what did the *market*
 * pay for it. The default four are deliberately not among them — they are a
 * cross-section of all four questions, which is the right opening view and a
 * poor answer to any one of them, and `reset` is how a reader gets back to it.
 *
 * `Value` mixes the KTC trio with the ADP total on purpose: three columns is the
 * whole KTC catalogue and the fourth slot is better spent on the second opinion
 * than left showing a rank from another lens.
 */
export const LEAGUE_COLUMN_PRESETS: ColumnPreset[] = [
  { name: "Scoring", columns: ["points", "points_for", "proj", "proj_pts"] },
  {
    name: "Projection",
    columns: ["proj", "proj_pts", "proj_bench", "proj_bench_pts"],
  },
  { name: "Value", columns: ["ktc_start", "ktc_total", "ktc_bench", "adp_total"] },
  { name: "Market", columns: ["adp_rank", "adp_total", "ktc_start", "points"] },
];
