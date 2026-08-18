import { formatPoints, formatValue } from "./format.ts";
import type { LeagueDataset } from "./league-detail-needs.ts";
import type { ColumnPreset, Metric } from "./metric-cell.ts";
import type { LeagueTeamPayload } from "@/shared/contract";
import type { TeamOutlook } from "@/shared/projections";

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
 * formatValue} — the team and outlook shapes arrive as erased `import type`s — so
 * the accessors read and test without a fetch behind them, the same bar
 * `league-metrics` holds.
 *
 * In `features/shared` for the reason its roster-level twin is: the panel these
 * columns sit in is drawn by the trades board as well as by the leagues list.
 */

/** What a team metric reads from: one team's standings row, outlook and board totals. */
export type TeamMetricContext = {
  /**
   * The team's standings row, or **null where there is no row to read**.
   *
   * Null is not "loading": it is a caller that has a roster without a standings
   * line behind it, which is what a rewind hands over — the timeline knows who
   * held which players at a past moment and nothing about a record or a
   * points-for that only exists for today. The one metric that reads this says
   * so rather than printing a zero, on the terms every other absence here is
   * spelled: an em dash and a hover, never a number attributed to nobody.
   */
  team: LeagueTeamPayload | null;
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
  /**
   * The week this panel is being read as, when it is being read as one at all —
   * null on the leagues list and the trades board, which open a league on a
   * season. See the roster catalogue's twin of this field.
   */
  week: number | null;
  /** This team's best and current lineup for {@link week}. */
  weekProjection: {
    optimal: number;
    current: number;
    points_left: number;
  } | null;
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
 *
 * A {@link MetricCell}'s `value` shape spelled out, which is the whole of what
 * this catalogue ever produces — the standings has no rank cell to place a
 * placing in. Naming the kind is not decoration: it is what makes a
 * {@link TeamMetric} a {@link Metric} the shared columns editor can lay out
 * unadapted.
 */
export type TeamMetricCell = { kind: "value"; text: string | null; title: string };

/**
 * One selectable team metric: its key, its short column label, and how to read
 * it.
 *
 * A {@link Metric} at this catalogue's grain, narrowed to the one cell shape it
 * returns. That earns both halves: the editor takes the catalogue as
 * `Metric<TeamMetricContext>[]` with no adapter in between, while `standings.tsx`
 * still reads `cell.text` off a cell it doesn't have to narrow out of a union.
 *
 * **`Omit` and not a plain intersection**, which is the spelling that reads
 * right and silently loses the narrowing: `{cell: A} & {cell: B}` makes `cell` an
 * overload of the two, and a call resolves to the *first* — `Metric`'s, which
 * returns the union. The compiler then rejects `cell.text` in the very file this
 * type exists to keep simple. `reads` is a new property rather than a narrowing,
 * so it needs none of that.
 */
export type TeamMetric = Omit<Metric<TeamMetricContext>, "cell"> & {
  cell: (ctx: TeamMetricContext) => TeamMetricCell;
  /**
   * Which of the panel's three enrichment reads this cell needs to say anything
   * — see {@link leagueDetailNeeds}, which is what turns these into requests.
   *
   * Declared per metric rather than inferred from {@link Metric.group}, which
   * happens to agree today and is a display caption: what a bay is *called* has
   * no business deciding whether a request is made. Required, so a metric added
   * here cannot forget to say what it costs.
   */
  reads: readonly LeagueDataset[];
};

/** The em-dash cell a projection-based metric returns when the league has no outlook. */
const noProjection: TeamMetricCell = {
  kind: "value",
  text: null,
  title: "No projection",
};

/**
 * The em-dash cell a standings-row metric returns for a roster with no such row.
 *
 * Distinct from {@link noProjection} because the two are different absences: one
 * is a league nothing could be projected for, the other a roster read at a moment
 * that has no standings behind it at all.
 */
const noStandingsRow: TeamMetricCell = {
  kind: "value",
  text: null,
  title: "No standings row to read this from",
};

/**
 * Every team metric a standings column can show, in the order the picker lists
 * them: the one week-grain number (what this team can score in the week a panel
 * was opened on, and nothing where it was opened on a season), the two projected
 * totals a season panel opens with — each week's best lineup and what
 * those lineups leave on the bench — the single season-long optimal lineup (a
 * different, always-smaller number, see {@link TeamOutlook}), the points the team
 * has actually scored so far, and the whole roster's value on the KTC and ADP
 * boards. The last two are totals only — no rank, since the standings has no rank
 * cell to place one in.
 */
export const TEAM_METRICS: TeamMetric[] = [
  {
    key: "week_proj",
    group: "Week",
    label: "Wk Proj",
    reads: ["week"],
    cell: ({ week, weekProjection }) => {
      if (week === null) {
        return {
          kind: "value",
          text: null,
          title: "Only answered where a panel is opened on a week",
        };
      }
      if (!weekProjection) {
        return { kind: "value", text: null, title: `No projection for week ${week}` };
      }
      // The team's *best* lineup for the week, which is what the `proj` metric
      // above means one grain up — each week's best lineup, read for one week.
      // What it is currently starting rides on the hover rather than in a third
      // column: the gap between the two is the lineup checker's whole subject,
      // and that tool states it in a column of its own on the row that opens
      // this panel.
      const { optimal, current, points_left } = weekProjection;
      return {
        kind: "value",
        text: formatPoints(optimal),
        title:
          `${formatPoints(optimal)} from the best lineup available in week ${week}` +
          ` · ${formatPoints(current)} as currently set` +
          (points_left > 0 ? ` · ${formatPoints(points_left)} left on the bench` : ""),
      };
    },
  },
  {
    key: "proj",
    group: "Projection",
    label: "Proj",
    reads: ["outlook"],
    cell: ({ outlook }) =>
      outlook
        ? {
            kind: "value",
            text: formatPoints(outlook.weekly_optimal_points),
            title: `${formatPoints(
              outlook.weekly_optimal_points,
            )} projected, setting the best lineup each week`,
          }
        : noProjection,
  },
  {
    key: "bench",
    group: "Projection",
    label: "Bench",
    reads: ["outlook"],
    cell: ({ outlook }) =>
      outlook
        ? {
            kind: "value",
            text: formatPoints(outlook.weekly_bench_points),
            title: `${formatPoints(
              outlook.weekly_bench_points,
            )} projected for players those lineups never start`,
          }
        : noProjection,
  },
  {
    key: "optimal",
    group: "Projection",
    label: "Optimal",
    reads: ["outlook"],
    cell: ({ outlook }) =>
      outlook
        ? {
            kind: "value",
            text: formatPoints(outlook.optimal_points),
            title: `${formatPoints(
              outlook.optimal_points,
            )} — one best lineup ranked over the whole horizon, not re-set each week`,
          }
        : noProjection,
  },
  {
    key: "pf",
    group: "Record",
    label: "PF",
    // The one team metric that is already on the core payload: the points a team
    // has scored ride on its standings row, so this column costs no request.
    reads: [],
    cell: ({ team }) =>
      team
        ? {
            kind: "value",
            text: formatPoints(team.fpts),
            title: `${formatPoints(team.fpts)} points for`,
          }
        : noStandingsRow,
  },
  {
    key: "ktc",
    group: "Value",
    label: "KTC",
    reads: ["values"],
    cell: ({ ktcTotal, superflex }) =>
      ktcTotal === null
        ? {
            kind: "value",
            text: null,
            title: "nothing on this roster is priced on KeepTradeCut",
          }
        : {
            kind: "value",
            text: formatValue(ktcTotal),
            title: `${formatValue(ktcTotal)} KeepTradeCut dynasty ${
              superflex ? "superflex" : "1QB"
            } value`,
          },
  },
  {
    key: "adp",
    group: "Value",
    label: "ADP",
    reads: ["values"],
    cell: ({ adpTotal, superflex, draftCount }) =>
      adpTotal === null
        ? { kind: "value", text: null, title: "no ADP value on the matching board" }
        : {
            kind: "value",
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

/**
 * The named pairs the columns editor offers as one press each.
 *
 * Two slots are still rarely two independent choices: a reader arrives at this
 * table with a question, and each of these is one — what will these rosters
 * score, what have they done, what are they worth. `Season` is the pair that has
 * to be read together to mean anything, since one best lineup over the horizon
 * and the points already banked are the two halves of a whole year.
 *
 * **There is no `Week` preset, and its absence is the rule rather than an
 * omission.** A preset names a *pair*, and the week grain has one metric left —
 * on the panel where that metric means anything the table is one slot wide, so a
 * preset writing it would be the table's own default under another name, and on a
 * season panel it would seat a column of em dashes.
 */
export const TEAM_COLUMN_PRESETS: ColumnPreset[] = [
  { name: "Projection", columns: ["proj", "bench"] },
  { name: "Season", columns: ["optimal", "pf"] },
  { name: "Value", columns: ["ktc", "adp"] },
];

/**
 * The column the standings opens with **when the panel is opened on a week** —
 * what each team can score in it.
 *
 * Stored under a key of its own rather than sharing the season panel's, for the
 * reason its roster-level twin is: the grain is a week rather than the rest of a
 * season, so a reader who aims this column on the lineup checker has not thereby
 * re-aimed the leagues list's.
 *
 * **One column and not two, which is a fact about the table's *shape* and not
 * only about its defaults**: `resolveColumns` takes the row's length from this
 * array, so a week panel is one slot wide and the standings picks the matching
 * grid template off the count (see `Standings`). It carried a points-per-game
 * column beside this one, which is what the second slot was for.
 */
export const DEFAULT_WEEK_TEAM_COLUMNS: string[] = ["week_proj"];
