import { formatPoints, formatValue, formatWeekRange } from "./format.ts";
import type { ColumnPreset, Metric } from "./metric-cell.ts";
import type {
  AdpBoardType,
  LeagueAdpBoardValue,
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
 * The **ADP metrics are one per league-type board**, where they were one apiece
 * reading whichever board matched the league. A column is scanned down a list
 * holding dynasty and redraft leagues together, so a single "ADP value" put two
 * markets' numbers under one heading and nothing on the card said which row was
 * which. Splitting them costs nothing at the fetch — `/api/user/…/adp-value`
 * prices every roster on both boards out of one query — and buys the reading the
 * pooled column could never give: a team high on the dynasty board and low on
 * the redraft one is rebuilding, and the other way round is built to win now.
 * Both are honest for any league, so neither is blanked outside its own market;
 * the hover names which market the league actually plays in.
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
  /**
   * This roster's ADP-derived value here on both league-type boards, or null
   * while loading / with no roster. A column reads one of the two sides; which
   * market the league itself is in rides along as `board`, for the hover.
   */
  adp: LeagueAdpEntry | null;
  /** The weeks behind the projected numbers, for a hover that says what it covers. */
  weeks: number[];
  /** When the KTC values were scraped, for the KTC metrics' hover. */
  valuedAt: string | null;
};

/**
 * Which of the leagues list's batch reads a metric needs.
 *
 * `ranks`, `ktc` and `adp` are three separate routes and two of them are
 * expensive in ways a column being *off* does not make cheaper: the KTC
 * valuation solves every team's optimal lineup in every league, and the ADP one
 * prices every roster against a crawled board. A reader whose four columns name
 * none of them was paying for both anyway.
 *
 * **`projections` is the fourth and is not a route** — it is the expensive
 * *half* of the ranks one. That read is unconditional (the record ledge needs
 * the standing, and no column controls that), but the standing and the points
 * rank come straight off the rosters it already fetches, where the projected
 * starter and bench ranks are a lineup solve per team per remaining week in
 * every projectable league. Four of the thirteen metrics read them, and the
 * `Value` and `Market` presets are one press away from naming none of the four —
 * so it is asked for separately, as `?projections=0` on the same request rather
 * than as a request of its own. Splitting the *route* would make the cheap half
 * a second round trip for every reader who does want both, which is most of
 * them; splitting the *work* costs nothing either way.
 */
export type ManagerDataset = "ranks" | "ktc" | "adp" | "projections";

/**
 * One selectable league metric — {@link Metric} bound to this catalogue's grain,
 * plus which batch read its cell reaches into.
 *
 * The cell shapes it can return, and the reason a rank and a value render
 * differently, live with {@link MetricCell}: they are shared with the share cards'
 * catalogue, which is drawn by the same column.
 *
 * `reads` is declared per metric rather than inferred from {@link Metric.group},
 * which happens to agree today and is a display caption: what a bay is *called*
 * has no business deciding whether a request is made. It is required, so a metric
 * added here cannot forget to say what it costs — the failure otherwise is a
 * column that quietly draws an em dash because nothing asked for its data.
 *
 * `Omit<…, never>` is not needed here — `reads` is a new property rather than a
 * narrowing of `cell`, so the intersection cannot collapse into an overload the
 * way `TeamMetricCell`'s did.
 */
export type LeagueMetric = Metric<MetricContext> & {
  /** The batch reads this metric's cell needs to say anything. */
  reads: readonly ManagerDataset[];
};

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
 * The ADP-value column's hover, shared by all four ADP metrics. Names the value,
 * the split, the board it was priced on and how many crawled drafts stood behind
 * it — the same "say what the number rests on" habit the KTC and projection
 * hovers keep, and the reminder that this is a consensus board, not fantasy
 * points.
 *
 * `market` is which of the two boards the column reads, and it is spelled out
 * because that is the whole question these four columns divide on: two of them
 * are reading a market this league doesn't play in, which is a comparison rather
 * than a mistake and only says so if the hover names both. So a non-native
 * column ends with what the league's own market is.
 */
function adpTitle(
  adp: LeagueAdpEntry | null,
  market: AdpBoardType,
): string {
  if (!adp) return "no players priced from ADP";
  const value = adp[market];
  const board = `${adp.superflex ? "superflex" : "1QB"} ${market}`;
  if (value.priced === 0) {
    return `no players priced on the ${board} board · ${value.draft_count} crawled draft${
      value.draft_count === 1 ? "" : "s"
    }`;
  }
  return [
    value.starters_rank &&
      `#${value.starters_rank.rank} of ${value.starters_rank.of} by starter value`,
    value.split && `${formatValue(value.split.starters)} starting`,
    value.split && `${formatValue(value.split.bench)} on the bench`,
    `${formatValue(value.total)} ADP draft-capital value`,
    `${value.priced} of ${adp.rostered} rostered players priced`,
    `averaged over ${value.draft_count} crawled ${board} draft${
      value.draft_count === 1 ? "" : "s"
    }`,
    adp.board !== market && `this league is a ${adp.board} league`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * How a market names itself in a column heading.
 *
 * The market alone, with the rank column adding a `#` — measured rather than
 * chosen. A heading has 76px at `sm` and up and ~63px of a phone's equal share,
 * where `Redraft value` is 90px and `Redraft rank` 85px: both would truncate,
 * and a truncated heading is the only name its column has. `Redraft` is 51px and
 * `Redraft #` 61px, so both fit at every width. The `#` is also the notation the
 * cell under it prints (`#5 of 12`), which is a plainer way of saying "rank" than
 * the implicit convention the rest of this catalogue keeps (`Points` ranks,
 * `Points for` is the number behind it). What is left unsaid — that these are ADP
 * draft-capital numbers — the editor's `Draft market` bay and the hover say.
 *
 * The bare market word is not the league-type filter wearing the same spelling:
 * nothing in this rail names an attribute of a league, so a heading here reads as
 * a metric in the company of `Points` and `KTC start`, and the one place a reader
 * picks between them captions the bay.
 */
function marketLabel(market: AdpBoardType): string {
  return market === "dynasty" ? "Dynasty" : "Redraft";
}

/** The board a column reads, or null while the values are still loading. */
function adpBoard(
  adp: LeagueAdpEntry | null,
  market: AdpBoardType,
): LeagueAdpBoardValue | null {
  return adp ? adp[market] : null;
}

/**
 * One market's whole-roster value. Built per market rather than written twice,
 * because the two differ in exactly one word and a copied pair is where a fix
 * lands on one board and not the other.
 */
function adpValueMetric(market: AdpBoardType): LeagueMetric {
  return {
    key: `adp_total_${market}`,
    group: "Draft market",
    label: marketLabel(market),
    reads: ["adp"],
    cell: ({ adp }) => {
      const board = adpBoard(adp, market);
      return {
        kind: "value",
        // Nothing priced is a real, empty answer rather than a value of zero —
        // an em dash, the same reading the KTC total takes. It is the ordinary
        // answer for a market the drawer's window holds no drafts from.
        text: board && board.priced > 0 ? formatValue(board.total) : null,
        title: adpTitle(adp, market),
      };
    },
  };
}

/** Where this roster's starters place among the leaguemates' on one market. */
function adpRankMetric(market: AdpBoardType): LeagueMetric {
  return {
    key: `adp_rank_${market}`,
    group: "Draft market",
    label: `${marketLabel(market)} #`,
    reads: ["adp"],
    cell: ({ adp }) => ({
      kind: "rank",
      rank: adpBoard(adp, market)?.starters_rank ?? null,
      title: adpTitle(adp, market),
    }),
  };
}

/**
 * Every metric a stat column can show, in the order the picker lists them: the
 * rankings a card can be read on — the standing excepted, which the record line
 * states — each paired where it makes sense with the raw number
 * behind it, the projected bench beside the projected starters (depth ranked the
 * same way, since two teams level on starters aren't level when one carries twice
 * as much behind them), the two KTC totals a starter rank alone can't tell apart,
 * and the draft market's value and rank once per league-type board.
 */
export const LEAGUE_METRICS: LeagueMetric[] = [
  {
    key: "points",
    group: "Record",
    label: "Points",
    reads: ["ranks"],
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
    reads: ["ranks"],
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
    reads: ["ranks", "projections"],
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
    reads: ["ranks", "projections"],
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
    reads: ["ranks", "projections"],
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
    reads: ["ranks", "projections"],
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
    group: "Trade value",
    label: "KTC start",
    reads: ["ktc"],
    cell: ({ ktc, valuedAt }) => ({
      kind: "rank",
      rank: ktc?.starters_rank ?? null,
      title: ktcTitle(ktc, valuedAt),
    }),
  },
  {
    key: "ktc_total",
    group: "Trade value",
    label: "KTC total",
    reads: ["ktc"],
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
    group: "Trade value",
    label: "KTC bench",
    reads: ["ktc"],
    cell: ({ ktc, valuedAt }) => ({
      kind: "value",
      // `split` is null when there is no lineup to divide the value by — a league
      // with nothing left to project — so bench has no answer, not a zero.
      text: ktc?.split ? formatValue(ktc.split.bench) : null,
      title: ktcTitle(ktc, valuedAt),
    }),
  },
  // The two markets of each ADP shape sit next to each other rather than the two
  // shapes of each market, so the columns a reader is choosing *between* are
  // adjacent in the editor's bay — the order `PLAYER_ADP_METRICS` lists its own
  // pairs in, for the same reason.
  adpValueMetric("redraft"),
  adpValueMetric("dynasty"),
  adpRankMetric("redraft"),
  adpRankMetric("dynasty"),
];

/** The metric list keyed by id, for resolving a column's stored selection. */
export const LEAGUE_METRICS_BY_KEY: Record<string, LeagueMetric> =
  Object.fromEntries(LEAGUE_METRICS.map((metric) => [metric.key, metric]));

/** Which of the leagues list's batch reads — and which halves of them — to make. */
export type ManagerDataRequirements = Record<ManagerDataset, boolean>;

/**
 * Which batch reads a column selection actually needs.
 *
 * The stat columns are four slots out of a catalogue of thirteen, so a reader can
 * — and does — aim all four away from a whole dataset. Both of the optional ones
 * are expensive at the far end: `/api/user/…/ktc` solves every team's optimal
 * lineup in every league the manager plays in, and `/api/user/…/adp-value` prices
 * every one of those rosters against a crawled ADP board, per board. Neither was
 * gated on anything but "are there leagues", so a board of four projection
 * columns paid for both on every visit and drew neither.
 *
 * **`ranks` is unconditional, and that is a fact about the card rather than about
 * this catalogue.** The record ledge on every card's trailing corner reads
 * `ranks.standing` — the standing is deliberately *not* a metric, because it is
 * what the record means in its league and belongs beside it — so the ranks read
 * is load-bearing whatever the four columns say. It is returned rather than left
 * implicit so the rule has somewhere to be asserted: a future edit that folds it
 * into the same derivation as the other two would silently blank a fact no column
 * controls.
 *
 * **`projections` is the half of that read which is not**, and it is the one
 * derivation here that saves CPU rather than a request: the ranks call is made
 * either way, and `?projections=0` is what stops it running a lineup solve per
 * team per remaining week across every league. It is derived exactly like `ktc`
 * and `adp` — nothing declares it, nothing computes it — so a board whose four
 * columns name no projection asks for the cheap answer and still gets its
 * standing.
 *
 * A key naming no metric (a selection stored by an older build) requires nothing,
 * which is `resolveColumns`' fallback arriving here as well: a slot that cannot
 * be drawn should not be a slot that fetches.
 *
 * Pure, so the mapping from a stored selection to a set of requests is checkable
 * without a renderer — the whole point of extracting it, since the failure it
 * prevents is invisible on screen in both directions.
 */
export function managerDataRequirements(
  columns: readonly string[],
): ManagerDataRequirements {
  const needs: ManagerDataRequirements = {
    ranks: true,
    ktc: false,
    adp: false,
    projections: false,
  };
  for (const key of columns) {
    for (const dataset of LEAGUE_METRICS_BY_KEY[key]?.reads ?? []) {
      needs[dataset] = true;
    }
  }
  return needs;
}

/**
 * The four columns a card opens with — one ranking from each of the four
 * questions the catalogue is grouped by, so the opening view is a cross-section
 * rather than a deep read of any one lens.
 *
 * The standing is deliberately not among them and cannot be: it is stated on the
 * card's record line, and spending a slot restating it is what taking it out of
 * the catalogue was for. A stored selection naming it falls back per slot, which
 * is `resolveColumns` doing its job rather than something to migrate.
 *
 * The market slot has to name one of the two boards now, and it names the
 * dynasty one — beside a KTC rank that is also a dynasty board, so the two value
 * lenses in the opening view are read off the same market and their disagreement
 * means something. A reader whose leagues are redraft aims that slot at the
 * column beside it, which is one press. A selection stored before the split held
 * `adp_rank`, which no longer names a metric; `resolveColumns` falls that slot
 * back on its own rather than resetting the other three, which is the migration.
 */
export const DEFAULT_COLUMNS: string[] = [
  "points",
  "ktc_start",
  "proj",
  "adp_rank_dynasty",
];

/**
 * The boards worth a name, as the columns editor offers them.
 *
 * Each is a question rather than a theme: how is this team *doing*, what is it
 * *going* to do, what is it *worth* to a trader, what did the *market* pay for
 * it. The default four are deliberately not among them — they are a
 * cross-section of all four questions, which is the right opening view and a
 * poor answer to any one of them, and `reset` is how a reader gets back to it.
 *
 * `Value` mixes the KTC trio with an ADP total on purpose: three columns is the
 * whole KTC catalogue and the fourth slot is better spent on the second opinion
 * than left showing a rank from another lens. It takes the *dynasty* board,
 * since the three columns beside it are a dynasty board too and a preset that
 * quietly changes market halfway across is four columns that don't add up.
 *
 * `Market` is the split itself — both markets' value against both markets' rank
 * — because the question that preset answers is which of the two a roster is
 * built for, and that is only readable with them side by side.
 */
export const LEAGUE_COLUMN_PRESETS: ColumnPreset[] = [
  { name: "Scoring", columns: ["points", "points_for", "proj", "proj_pts"] },
  {
    name: "Projection",
    columns: ["proj", "proj_pts", "proj_bench", "proj_bench_pts"],
  },
  {
    name: "Value",
    columns: ["ktc_start", "ktc_total", "ktc_bench", "adp_total_dynasty"],
  },
  {
    name: "Market",
    columns: [
      "adp_total_redraft",
      "adp_total_dynasty",
      "adp_rank_redraft",
      "adp_rank_dynasty",
    ],
  },
];
