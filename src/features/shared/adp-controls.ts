import {
  ADP_PEAK,
  ADP_VALUE_PARAMS,
  DEFAULT_STEEPNESS,
  STEEPNESS_RANGE,
  TYPICAL_STARTING_SLOTS,
  adpValue,
  expectedAdpValue,
} from "../../shared/manager/adp-value.ts";
import type { AdpDistribution } from "../../shared/manager/adp-value.ts";
import {
  MONTH_ABBREVIATIONS,
  formatRangeDate,
  formatRangeMonth,
  shiftDays,
  shiftMonths,
  todayIso,
} from "./date-range.ts";
import { DEFAULT_LEAGUE_FILTERS, TEAMS_KEY } from "./league-filters/defaults.ts";
import {
  deriveScoring,
  leagueAdpBoard,
  slotCount,
} from "./league-filters/predicates.ts";
import { activeFilterCount } from "./league-filters/summaries.ts";
import type { FilterRule, LeagueFilters } from "./league-filters/types.ts";
import {
  type LeagueScope,
  type LeagueScopeBody,
  leagueScopeBody,
  scopeNeedsBody,
  sortedIds,
} from "./league-scope.ts";
import { TYPICAL_DRAFT_TEAMS } from "./pick-value.ts";
import type { AdpBoardType, ManagerLeague } from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";

// Re-exported rather than re-imported at each call site: this module's own
// consumers (the drawer, the window control, `range-domain`) already import
// `todayIso` and friends from *here*, a habit that predates this file's own
// move into `features/shared` — the manager tool's `adp-controls` still hands
// them out under the same names for its own callers, per the mover's rule.
export {
  MONTH_ABBREVIATIONS,
  deriveScoring,
  formatRangeDate,
  formatRangeMonth,
  shiftDays,
  todayIso,
};

// The value curve is the server's own, so its bounds and its default come from
// the module that defines the curve rather than being re-typed here — this used
// to be a matched pair of three strings with no compiler link, which is exactly
// the drift the doc warns about for the board vocabulary. A pure→pure value
// import, relative and with the extension, the way `isSuperflexLineup` above is.
export { ADP_PEAK, DEFAULT_STEEPNESS, STEEPNESS_RANGE };

/**
 * The ADP board controls on the Players tab: which crawled drafts the column's
 * average is taken over.
 *
 * Kept apart from the bar that renders it, and pure, for the same reason
 * `filters` is — the query it builds and the league-seeding it does encode
 * `/api/adp`'s own vocabulary (the scoring buckets, the league-type codes, the
 * auction exclusion), and that is worth reading and testing without a fetch
 * behind it. Every field is a single-select the bar drives; a `null`/`"all"`
 * value means "don't narrow on this", which the query builder turns into an
 * omitted parameter — the same tri-state the route parses.
 *
 * These are a different concern from the header's {@link LeagueFilters}: those
 * narrow *which of this manager's leagues* a share is counted over; these narrow
 * *which drafts in the database* the ADP is averaged from. One is about the
 * manager, the other about the market — so they don't share state.
 */
export type AdpControls = {
  /**
   * The season the drafts were *for* — a 4-digit year, or `"all"` to pool every
   * season on file.
   *
   * This is the board's population rather than one of its filters, which is why
   * it leads. ADP is a season's market: a pick number only means something
   * against the pool it was drafted from, and the 2026 rookie class is not in a
   * 2025 draft at all, so averaging the two answers no question anyone asked.
   * It is always sent, `"all"` included — omitting it would let the route apply
   * its own `DEFAULT_SEASON`, and that default is suppressed the moment a date
   * bound is present, so a narrowed window would silently go back to spanning
   * every season.
   */
  season: string;
  /** When within that season the drafts happened — see {@link AdpRange}. */
  range: AdpRange;
  /**
   * Which of the two league-type boards the drawer's list displays — see
   * {@link AdpShownBoards}. Unlike every filter below it, this narrows nothing:
   * the fetch always averages the redraft and dynasty markets side by side, and
   * this only says which columns are drawn. `adpQueryString` never reads it and
   * `adpNarrowingCount` never counts it, the same standing `steepness` has.
   */
  boards: AdpShownBoards;
  /**
   * What the *leagues* behind these drafts are — the shared league filters, the
   * same dialog and the same rules the manager tabs and the trades board narrow
   * with.
   *
   * It replaced four chips of this drawer's own: scoring, superflex, best ball
   * and league size. Each was a fixed question out of a space readers arrive at
   * a board with their own question in — "average the drafts of leagues that
   * start a linebacker", "half PPR with a TE bonus" — and each already had an
   * exact equivalent in the rule vocabulary (`qb+sf ≥ 2` *is* `isSuperflexLineup`;
   * the size chip is `teams = 12`). One control over one idea, rather than a
   * second filter language a few pixels from the first.
   *
   * **It does not travel as itself.** The rules are a predicate engine over
   * Sleeper's blobs, so the browser resolves them against the season's crawled
   * leagues and sends the answer as league ids — see `./league-scope` for why
   * that direction, and {@link adpBoardRead} for how they get on the wire. That
   * is also why this is not part of the query string a cache key is built from
   * and the resolved scope is: two rule sets that leave the same leagues are one
   * board.
   *
   * The two filter sets on the manager tabs stay independent of it, which is the
   * old rule unchanged and now easier to get wrong because both are the same
   * control: the header's league filters narrow *which of this manager's leagues*
   * a share is counted over, and these narrow *which leagues in the database* the
   * average is taken from. A dynasty rule on the header means "count my dynasty
   * leagues"; the same rule here means "average dynasty drafts, strangers'
   * included".
   */
  leagueRules: LeagueFilters;
  /**
   * The draft's round count, bucketed — which is to say *what kind of draft* it
   * was: a rookie draft's pick 1 and a startup's pick 1 are different games, the
   * doc's own example, so the board can split the short rookie drafts from the
   * full ones rather than average across them. It is offered under those names
   * rather than as a round count, because the round count is the evidence and
   * the kind of draft is the question.
   *
   * It opens on `"full"` rather than `"all"` — see {@link DEFAULT_ADP_ROUNDS}.
   */
  rounds: "all" | "rookie" | "full";
  /**
   * How top-heavy the ADP → value curve is, as the number of times value halves
   * across a league's startable pool. Unlike every field above it, this doesn't
   * narrow *which drafts* are averaged — it sets how a player's ADP converts
   * into value once averaged, so it rides on the per-player board (which is a
   * raw number) doing nothing and drives the two places a *roster's* worth of
   * ADP is summed: the Leagues tab's team value, and the trades board's own
   * value column, where a haul is priced on the league it was traded in.
   *
   * A number rather than one of three preset names, because it is a single
   * scalar with an obvious ordering and the three names were only ever three
   * points on it — the drawer drives it with a slider and sends the number to
   * `/api/user/[username]/adp-value`, which clamps it to {@link STEEPNESS_RANGE}.
   * Both ends now read that range from one module, so this is no longer a
   * vocabulary the two sides can drift apart on.
   */
  steepness: number;
};

/**
 * The window the board's drafts are taken from *within its season*, as a preset
 * plus the two dates a custom window carries.
 *
 * A window as well as a season, because the two are different cuts and both are
 * wanted: the season is which market, the window is when inside it. Every
 * dynasty league runs a rookie draft in May and a startup in August under the
 * one season label, and those are two very different boards — which is the cut
 * no season can express, the same way no window can keep last year's player pool
 * out of this year's average.
 *
 * The relative presets are resolved against a supplied `today` rather than a
 * stored date ({@link rangeBounds}), so "last 90 days" keeps meaning that
 * tomorrow — and stays a pure function worth testing.
 */
export type AdpRange = {
  preset: AdpRangePreset;
  /** `YYYY-MM-DD`, both inclusive. Read only when `preset` is `"custom"`; either may be null for an open end. */
  from: string | null;
  to: string | null;
  /**
   * Read only when `preset` is `"lookback"`: how many days back from today the
   * window starts. A *relative* window like the named presets — `30d` and `90d`
   * are the two named points on this scale, kept as their own values so the
   * resting line's chips still light exactly — and unlike `custom` it rolls
   * forward with the calendar, which is the counter's promise for a window
   * that ends on today.
   */
  days?: number;
};

export type AdpRangePreset = "30d" | "90d" | "12m" | "all" | "custom" | "lookback";

/**
 * Which league-type boards the drawer's list displays: both side by side, or
 * one of them alone. A three-value union rather than a flag per board so that
 * "neither" is unrepresentable — a selection that can express a blank board is
 * a selection that will eventually show one.
 */
export type AdpShownBoards = "both" | AdpBoardType;

/** Whether each board is displayed under a given selection. */
export function shownAdpBoards(
  shown: AdpShownBoards,
): Record<AdpBoardType, boolean> {
  return { redraft: shown !== "dynasty", dynasty: shown !== "redraft" };
}

/**
 * Flip one board's visibility. Turning off the only board showing is a no-op
 * rather than an empty list, which is what the union above makes structural —
 * the caller needs no guard, pressing the last lit key simply does nothing.
 */
export function toggleAdpBoard(
  shown: AdpShownBoards,
  board: AdpBoardType,
): AdpShownBoards {
  const other: AdpBoardType = board === "redraft" ? "dynasty" : "redraft";
  if (shown === "both") return other;
  if (shown === other) return "both";
  return shown;
}

/** Total sample behind a row, both boards pooled — the sort's tiebreaker. */
const totalPicks = (player: AdpPlayerPayload): number =>
  (player.redraft?.picks ?? 0) + (player.dynasty?.picks ?? 0);

/**
 * The rows the drawer's list displays for a boards selection, in that display's
 * own order, ranked by the caller as it renders (index + 1).
 *
 * The fetch orders rows by the best average on *either* board, so the page cut
 * is fair to both markets — and therefore matches neither column read alone,
 * which is why the display re-sorts. A single board keeps only the players it
 * can average (a row of em dashes answers nothing) and sorts on that column.
 * Both boards keep every row: the redraft column orders everything it prices,
 * and the players only the dynasty board took — rookies, mostly — follow as a
 * tail in dynasty order rather than being interleaved on numbers from two
 * different markets.
 */
export function adpBoardRows(
  players: readonly AdpPlayerPayload[],
  shown: AdpShownBoards,
): AdpPlayerPayload[] {
  const primary: AdpBoardType = shown === "dynasty" ? "dynasty" : "redraft";
  const secondary: AdpBoardType = primary === "redraft" ? "dynasty" : "redraft";
  const kept =
    shown === "both" ? [...players] : players.filter((p) => p[primary] !== null);

  return kept.sort((a, b) => {
    const first = a[primary];
    const second = b[primary];
    if (first && second) {
      if (first.adp !== second.adp) return first.adp - second.adp;
      // The server's own tiebreak: the better-sampled row first, then the id
      // so the order is total and stable across refetches.
      const picks = totalPicks(b) - totalPicks(a);
      if (picks !== 0) return picks;
      return a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0;
    }
    if (first) return -1;
    if (second) return 1;
    const aTail = a[secondary]?.adp ?? Number.POSITIVE_INFINITY;
    const bTail = b[secondary]?.adp ?? Number.POSITIVE_INFINITY;
    return aTail - bTail;
  });
}

/**
 * What each named preset is *called*, which is all that is left of them.
 *
 * They were a row of chips beside the window control, and a second, seasonal
 * list (`adpRangePresets`) decided which of them a given board could honestly
 * offer — a relative window means nothing on a season that cannot contain
 * today. Both are gone: the window counter is expanded in place, so every one
 * of these is a day count typed or stepped into its lens, and a chip row beside
 * an open instrument is two controls for one selection.
 *
 * What survives is the **naming**, which is not the chips' leftovers: a preset
 * keeps its name wherever a range is read alone ({@link rangeLabel}) precisely
 * because the name stays true as time passes, where the dates behind it would
 * have to be re-read. `30d` and `90d` are also still the storage
 * `lookbackRange` writes those two counts into, so a board holding one of them
 * is named from this table rather than from its day count — the same string
 * either way, and one spelling of it.
 *
 * `custom` and `lookback` are deliberately absent, and always were: neither is
 * a mode you enter first. A custom window is what setting the counter's end
 * date produces, and a lookback is what any unnamed day count produces — both
 * name themselves from the dates or the count they carry.
 */
export const ADP_RANGE_PRESETS: AdpRangePresetOption[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

export type AdpRangePresetOption = {
  value: AdpRangePreset;
  label: string;
};

/**
 * The seasons the drawer offers, newest first, with `"all"` last.
 *
 * Taken from the density strip rather than counted off a calendar, so a season
 * nobody has crawled a draft for is not offered — except the two that must
 * always be there: the current season (which is the default, and is empty for a
 * few weeks every spring) and whatever is selected (a board should never lose
 * the chip that describes it). The list is capped because these are segments in
 * a row, not a menu, and the tail of it is the part nobody reads a board for.
 */
export function seasonOptions(
  months: readonly { season: string }[],
  selected: string,
  currentSeason: string,
  limit = 4,
): string[] {
  const seasons = new Set(months.map((m) => m.season));
  seasons.add(currentSeason);
  if (selected !== "all") seasons.add(selected);
  const ordered = [...seasons].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const kept = ordered.slice(0, limit);
  // A selection pushed off the end by the cap would leave the row describing a
  // board it isn't showing, so it takes the last slot instead of being dropped.
  if (selected !== "all" && !kept.includes(selected)) kept[kept.length - 1] = selected;
  return [...kept, "all"];
}

/**
 * The board's window when the drawer hasn't been touched: the whole season.
 *
 * It used to be twelve months, chosen to be wide enough that a quiet stretch of
 * crawling still returned drafts and narrow enough to keep last year out. With
 * the season doing that second job properly, a window on top of it would only
 * cut the season short — so the default narrows nothing and the season is the
 * whole answer.
 */
export const DEFAULT_ADP_RANGE: AdpRange = { preset: "all", from: null, to: null };

/**
 * The curve applied when the ADP drawer hasn't been touched. It *is* the curve
 * module's own default rather than a second spelling of it: it used to be a
 * string the two ends carried separately, and a third spelling was one curve
 * change away from the drawer pricing one thing and displaying another.
 */
export const DEFAULT_ADP_STEEPNESS: AdpControls["steepness"] = DEFAULT_STEEPNESS;

/**
 * The steepness slider's readout, in the units a reader actually holds a curve
 * in: what a league's *last startable pick* is worth against the 1.01.
 *
 * A halving count is the honest parameter and a meaningless label — "4.25
 * halvings per startable pool" is not a sentence anyone reads a board in. The
 * curve is `2^(−halvings)` a full pool deep, so this is that fraction as a
 * percentage, which moves visibly across the whole of the range (25% at the flat
 * end, well under 1% at the steep one) and says what the number does.
 */
export function steepnessSummary(halvings: number): string {
  const share = 2 ** -halvings * 100;
  return `last starter ≈ ${share < 1 ? share.toFixed(1) : Math.round(share)}% of the 1.01`;
}

/**
 * The startable pool the drawer's own preview prices against.
 *
 * The board in the drawer belongs to no league — it is the crawled market, not
 * a roster — so there is no lineup to anchor the curve to the way
 * `leagueAdpPool` does for a card. It uses the size filter when one is set (a
 * board narrowed to 10-team drafts should preview on a 10-team pool) and a
 * typical 12-team lineup otherwise, which is a *preview* premise and says so:
 * the number beside a card is priced on that league's real slots.
 */
export function previewAdpPool(rules: LeagueFilters): number {
  return previewDraftTeams(rules) * TYPICAL_STARTING_SLOTS;
}

/**
 * How many teams the drawer's board assumes are drafting: the size filter where
 * one is set, and a typical twelve otherwise.
 *
 * Its own function because two things read it and they must agree. The pool
 * above anchors the value curve; the pick rows enumerate a draft — a round's
 * worth of slots, and which rung a `2.01` lands on. A board previewing a 10-team
 * curve while numbering picks out of twelve would put the same pick in two
 * places at once. The fallback is {@link TYPICAL_DRAFT_TEAMS}, the one the pick
 * ladder already falls back to for a league with no size on file.
 *
 * **Only an exact size answers it.** The size chip this replaced could say
 * nothing but "12-team", so it was either a number or "all"; a size *rule* can
 * also say `teams ≥ 12`, which describes a range of pools rather than one — and
 * a preview that guessed at which end of it would be quoting a pool no filter
 * asked for. So an equality is read and everything else falls back, which is
 * what the footer's premise line states either way: the number beside a *card*
 * is priced on that league's real slots, and this one is a preview.
 */
export function previewDraftTeams(rules: LeagueFilters): number {
  const exact = rules.settings.find(
    (rule) => rule.key === TEAMS_KEY && rule.op === "eq",
  );
  const count = exact?.value ?? TYPICAL_DRAFT_TEAMS;
  return Number.isInteger(count) && count > 0 ? count : TYPICAL_DRAFT_TEAMS;
}

/**
 * A bare average as draft capital under the drawer's current curve — the curve
 * read at a point.
 *
 * It is what the **pick** rows want, and that is the whole of why it survives
 * beside {@link previewExpectedAdpValue}. A pick's stand is a *rung* — the Nth
 * rookie off the ordering board — so the ADP it carries is often interpolated
 * between two players and has no distribution at all; and where it does have
 * one, that player's own spread is not the pick's. What makes a 1.03 uncertain
 * is which player is available at it, which the ladder answers by rank, not how
 * far that particular rookie slides between drafts. Correcting for the second
 * would be answering a question nobody asked with a number that looks like the
 * answer to the first.
 */
export function previewAdpValue(
  adp: number,
  rules: LeagueFilters,
  steepness: number,
): number {
  return adpValue(adp, previewAdpPool(rules), steepness);
}

/**
 * A **player** row's draft-capital value: the same curve as the expectation over
 * the drafts behind his average rather than read at that average.
 *
 * Which is the number the cards are priced on, so this is the one the board's
 * own Value column has to show — a drawer previewing `v(mean)` over cards summed
 * from `E[v]` is the two-answers-to-one-question the panel and the cards were
 * put on one board to stop. See `expectedAdpValue` for what the two corrections
 * are and why they pull opposite ways.
 */
export function previewExpectedAdpValue(
  stats: AdpDistribution,
  rules: LeagueFilters,
  steepness: number,
): number {
  return expectedAdpValue(stats, previewAdpPool(rules), steepness);
}

/** The `rounds_min`/`rounds_max` bounds each rounds bucket sends. */
const ROUNDS_BOUNDS: Record<"rookie" | "full", { min?: number; max?: number }> = {
  // Rookie drafts are a handful of rounds; startups and redrafts fill a roster.
  // The gap between is left to "all" rather than claimed by either side.
  rookie: { max: 5 },
  full: { min: 12 },
};

/**
 * The kind of draft the board opens on: startups, not rookie drafts.
 *
 * It used to be `"all"`, on the reasoning that a default should narrow nothing
 * and let the reader cut where they want. That reads as neutral and isn't: in a
 * dynasty league every rookie is taken in the first round or two of a rookie
 * draft and somewhere in the middle of a startup, so pooling the two doesn't
 * average one market — it averages two, and the *rookies* are the rows it is
 * wrong about, which are the rows a dynasty board is most often opened for. An
 * unnarrowed board is only neutral where the population is one game.
 *
 * That makes this the same call `draft_type` already made one rule down: a board
 * is never over auctions, because nomination order is not a draft position. A
 * rookie draft's pick 1.01 is a real draft position, so this stays a *control*
 * rather than becoming a constant — the rookie board is a board someone can want
 * — but it is not what the panel opens on.
 *
 * `full` is the bucket labelled "Startup (12+ rds)" rather than a plain "not
 * rookie", so the 6–11 round drafts the two buckets deliberately leave to `all`
 * stay out of this one too: a board named for startups should hold drafts that
 * are recognisably startups, and the ambiguous middle is what "All drafts" is
 * for.
 */
export const DEFAULT_ADP_ROUNDS: AdpControls["rounds"] = "full";

/**
 * The two boards a **rookie pick's** value is read from, whatever the panel is
 * displaying — the reader's population, asked twice with the round bounds fixed.
 *
 * A rookie pick is a place in a queue, and the queue and the price come off
 * different drafts (`features/trades/pick-value` carries the argument). Rookie
 * drafts order one class against itself; startups price that class against the
 * whole player pool. So a pick's value needs *both*, and neither may be the
 * board the panel happens to be showing:
 *
 * - **`rounds` is the one control that must not propagate.** It is the choice
 *   between exactly these two populations, so honouring it here would mean a
 *   reader switching the panel to "Rookie" repriced every pick on the page off
 *   rookie-draft ADP — the 1.01 at ADP ~1, which the curve reads as the most
 *   valuable asset in dynasty football. That is presentation state reaching into
 *   a valuation, and it is what these two functions exist to sever.
 * - **Everything else does propagate**, because every other axis is a fact about
 *   *which market* rather than which question: the season, the window, the
 *   scoring, superflex, best ball and the league size all describe a population,
 *   and the two boards have to describe the same one or the ordering and the
 *   pricing are about different leagues.
 *
 * The bounds themselves are `ROUNDS_BOUNDS`, so the definition of "a rookie
 * draft" is the one the drawer's own chip uses and there is no second threshold
 * to drift. Both are plain derivations of the controls rather than query strings
 * so they compose with `adpQueryString` — and so a caller that already displays
 * one of these boards lands on the identical query, which is what makes the
 * extra fetch free in the common case.
 */
export function rookieOrderingBoard(controls: AdpControls): AdpControls {
  return { ...controls, rounds: "rookie" };
}

/** The board a rookie pick's *price* is read from — see above. */
export function startupPricingBoard(controls: AdpControls): AdpControls {
  return { ...controls, rounds: "full" };
}

/**
 * The starting board: one season of startup drafts, whole, both meaningful draft
 * types (snake + linear), no league narrowing, both league-type boards on
 * display.
 *
 * The season is an argument again. It was dropped when the range replaced it,
 * on the grounds that a date range needs no season and the shared store could
 * therefore hold a real selection from the start instead of a null each tab
 * filled in; the store still can, because the *layout* supplies the season now
 * rather than each consumer resolving it. What changed is the premise: a board
 * pooling two seasons is wrong at every row, so the season cannot be left out
 * of the default.
 */
export function defaultAdpControls(season: string): AdpControls {
  return {
    season,
    range: DEFAULT_ADP_RANGE,
    boards: "both",
    leagueRules: DEFAULT_LEAGUE_FILTERS,
    rounds: DEFAULT_ADP_ROUNDS,
    steepness: DEFAULT_ADP_STEEPNESS,
  };
}

/** The dates a range covers, as `YYYY-MM-DD`; null on a side it doesn't bound. */
export type AdpRangeBounds = { from: string | null; to: string | null };

/**
 * Resolve a range against today. The relative presets end open rather than at
 * today: a draft in progress can carry a start time hours ahead, and a board
 * that says "last 30 days" shouldn't drop it on a technicality.
 *
 * `today` is passed in (`YYYY-MM-DD`) rather than read from the clock so this
 * stays pure — and so a board's query string only changes when the *date* does,
 * not on every render.
 */
export function rangeBounds(range: AdpRange, today: string): AdpRangeBounds {
  switch (range.preset) {
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: range.from, to: range.to };
    case "30d":
      return { from: shiftDays(today, -30), to: null };
    case "90d":
      return { from: shiftDays(today, -90), to: null };
    case "12m":
      return { from: shiftMonths(today, -12), to: null };
    case "lookback":
      // A days-less lookback is malformed rather than meaningful, and it reads
      // as unbounded — the one answer that can't silently narrow the board.
      return range.days == null
        ? { from: null, to: null }
        : { from: shiftDays(today, -range.days), to: null };
  }
}

/**
 * What the range says on the trigger and in the drawer's header. A preset keeps
 * its name — "Last 90 days" stays true as time passes, where the dates behind it
 * would have to be re-read — and only a custom window spells its dates out.
 */
export function rangeLabel(range: AdpRange): string {
  if (range.preset === "lookback") {
    // The same name shape as the chips, so "Last 45 days" and "Last 30 days"
    // read as the one scale they are — and it stays true tomorrow, which is
    // what a relative window's label is for.
    return range.days == null ? "All time" : `Last ${range.days} day${range.days === 1 ? "" : "s"}`;
  }
  if (range.preset !== "custom") {
    return ADP_RANGE_PRESETS.find((p) => p.value === range.preset)!.label;
  }
  const { from, to } = range;
  if (from && to) return `${formatRangeDate(from)} – ${formatRangeDate(to)}`;
  if (from) return `Since ${formatRangeDate(from)}`;
  if (to) return `Through ${formatRangeDate(to)}`;
  // A custom range with neither end set narrows nothing, so say what it does.
  return "All time";
}

/** A range that bounds neither end — every draft in whatever season is chosen. */
export function isUnboundedRange(range: AdpRange): boolean {
  return (
    range.preset === "all" ||
    (range.preset === "custom" && range.from === null && range.to === null) ||
    // The malformed spelling `rangeBounds` already reads as unbounded; counting
    // it as a narrowing would light the trigger for a window that cuts nothing.
    (range.preset === "lookback" && range.days == null)
  );
}

/**
 * What the *board* is, in one line: the season and the window inside it. This is
 * what the trigger, the drawer's header and the page caption all name, where
 * {@link rangeLabel} names the window alone — right for the strip's own caption,
 * which sits directly under the season it belongs to, and wrong everywhere else
 * now that "Last 30 days" is only half of the answer.
 *
 * An unbounded window is folded into the season rather than appended to it: a
 * board reading "2026 · All time" would be claiming two contradictory things.
 */
export function boardLabel(range: AdpRange, season: string): string {
  if (season === "all") return rangeLabel(range);
  if (isUnboundedRange(range)) return `All of ${season}`;
  return `${season} · ${rangeLabel(range)}`;
}

/**
 * How many of the board's settings are narrowing it away from the default —
 * which, since the trigger stopped naming the board, is the one fact about it
 * worth carrying outside the drawer.
 *
 * The trigger used to say `All of 2026 · 1,204 drafts` and therefore needed no
 * indicator: it stated which board was loaded. Moved into the app bar it says
 * only `ADP`, so the reader loses the difference between the board they left
 * narrowed and the one everybody else sees — and that difference is exactly what
 * makes a number on the page behind it mean something else. A count rather than
 * a boolean because the caller can spell it either way, and because it is the
 * same shape `activeFilterCount` hands the league filters' own trigger.
 *
 * Every field is compared against **the default**, never against "unnarrowed" —
 * which is the same thing for five of them and not for `rounds`, whose default is
 * startups rather than every draft ({@link DEFAULT_ADP_ROUNDS}). A board nobody
 * has touched must count zero, or the bars light for every reader on every page
 * and stop meaning "yours differs from theirs"; the season has always been read
 * this way, which is the precedent.
 *
 * Two judgement calls in what it counts. The **season** counts, though it is the
 * board's population rather than one of its filters: a reader looking at 2024
 * against a default of 2026 is reading a different market, which is a larger
 * departure than any filter here, not a smaller one. The **steepness** does not,
 * because it narrows nothing — it converts an ADP into value once averaged, so
 * it changes what the Leagues tab's cards and the trades board's value column
 * say while leaving the population the trigger describes untouched. `boards` follows the steepness for the same reason: which
 * of the two markets is drawn is a display choice over an unchanged population,
 * the same kind of selection as which stat column a league card shows.
 */
export function adpNarrowingCount(
  controls: AdpControls,
  defaultSeason: string,
): number {
  const narrowing = [
    controls.season !== defaultSeason,
    !isUnboundedRange(controls.range),
    controls.rounds !== DEFAULT_ADP_ROUNDS,
  ];
  // Every league rule counts as one, the same arithmetic `activeFilterCount`
  // does for the filters' own trigger: eight rules are eight narrowings, and
  // rolling the list up as "1" would understate a selection doing most of the
  // work. That the two triggers now count the same way is the point — the
  // dialog behind them is one dialog.
  return narrowing.filter(Boolean).length + activeFilterCount(controls.leagueRules);
}

/**
 * The dates a range actually resolves to, in words — `since Aug 1, 2025`, `up
 * to Mar 3, 2026`, the pair when it is bounded both ways.
 *
 * It is what {@link rangeLabel} deliberately doesn't say. A preset keeps its
 * name everywhere the label is read alone, because the name stays true as time
 * passes; but *inside* the control, where the handles are sitting on those
 * dates, naming the window without naming its edges leaves the reader to work
 * back from the axis. Null when the range bounds nothing — "all time" needs no
 * gloss, and an empty summary is what the caller skips rendering.
 */
export function rangeSummary(range: AdpRange, today: string): string | null {
  const { from, to } = rangeBounds(range, today);
  if (from && to) return `${formatRangeDate(from)} – ${formatRangeDate(to)}`;
  if (from) return `since ${formatRangeDate(from)}`;
  if (to) return `up to ${formatRangeDate(to)}`;
  return null;
}

/**
 * Fill the board's league rules from one of the manager's leagues — the
 * "associated league setting" shortcut. It writes what a league payload carries:
 * the scoring bucket, whether it starts more than one quarterback, best ball and
 * the size. `range` and `rounds` are left as they were: neither is a league
 * setting — when a draft happened and what kind of draft it was are facts about
 * the room, not about the league it filled. The league's *type* is not a rule it
 * writes either; what it sets instead is which board the list displays, so
 * matching a dynasty league shows the dynasty column alone — the market that
 * league is actually in.
 *
 * **The rules it writes are the buckets, not the league's exact numbers**, and
 * that is the whole subtlety of seeding. `rec = 0.5` off a half-PPR league is
 * true and far narrower than the population that league belongs to: these boards
 * are a mix of house rules, and matching one exactly hands back a board of a
 * dozen drafts. The bucket is what the ADP endpoint groups by (`SCORING_SQL`),
 * so a seed lands on the population the league would actually have been counted
 * in — the rule the retired scoring chip already carried, kept here by spelling
 * the bucket as its two bounds. Superflex is the same: the predicate is "more
 * than one QB-eligible slot", so the rule is `qb+sf >= 2` or `<= 1` rather than
 * the exact count, which is what `isSuperflexLineup` asks and what `/api/adp`
 * classified a stored league with.
 *
 * Everything it writes is a rule the reader can then *edit*, which is what the
 * chips it replaced could not offer: a seeded `rec >= 0.5` becomes `rec >= 0.4`,
 * and a seeded `teams = 12` becomes `teams >= 10`.
 *
 * It **replaces** the three rule lists rather than appending to them, because a
 * seed answers "make this board look like that league" and rules left over from
 * a previous seed would quietly narrow it further.
 *
 * The season is seeded too, unlike the range beside it, because it *is* a league
 * setting — a 2025 league's board is read from 2025 drafts, and matching a
 * league while leaving the season on this year would price it against a market
 * it was never in. It usually lands on the season already selected, since a
 * manager's leagues are read one season at a time; the case it earns its keep
 * in is the one where they aren't.
 */
export function seedFromLeague(
  controls: AdpControls,
  league: ManagerLeague,
): AdpControls {
  const settings = league.settings ?? {};
  // Null where the lineup was never synced, which is the one case with no honest
  // rule to write: an unknown lineup is not evidence of a 1QB league, and a
  // `qb+sf <= 1` on it would seed a board this league may well not belong to.
  const qbSlots = slotCount(league, "QB+SF");

  return {
    ...controls,
    season: league.season,
    // Type 2 is dynasty and everything else — keeper included — reads the
    // redraft board, the bucketing the server's `ADP_BOARDS` documents. Read
    // through `leagueAdpBoard` rather than off `settings.type` here, because the
    // trade cards price a haul on the same question and two spellings of it is
    // how one of them ends up reading the wrong market.
    boards: leagueAdpBoard(league),
    leagueRules: {
      ...controls.leagueRules,
      bestBall: settings.best_ball === 1 ? "yes" : "no",
      settings: [{ key: TEAMS_KEY, op: "eq", value: league.total_rosters }],
      slots:
        qbSlots === null
          ? []
          : [{ key: "QB+SF", op: qbSlots > 1 ? "gte" : "lte", value: qbSlots > 1 ? 2 : 1 }],
      scoring: SCORING_BUCKET_RULES[deriveScoring(league.scoring_settings)],
    },
  };
}

/**
 * Each scoring bucket as the rules that select it — the bounds `SCORING_SQL`
 * groups by, written in the rule vocabulary.
 *
 * Half PPR is two rules because it is a band and the lists are an AND, which is
 * one of the things that AND is for. Standard is `rec < 0.5` rather than
 * `rec = 0` because Sleeper omits the key entirely for a league that pays
 * nothing per reception and a stored blob's missing key reads as 0 — so the
 * bound catches both spellings, and the quarter-point leagues between them.
 */
const SCORING_BUCKET_RULES: Record<
  ReturnType<typeof deriveScoring>,
  FilterRule[]
> = {
  ppr: [{ key: "rec", op: "gte", value: 1 }],
  half_ppr: [
    { key: "rec", op: "gte", value: 0.5 },
    { key: "rec", op: "lt", value: 1 },
  ],
  std: [{ key: "rec", op: "lt", value: 0.5 }],
};

/**
 * One read of an ADP board: the cache key it files under, and the HTTP request
 * that fetches it.
 *
 * **The key and the wire differ in exactly one thing, which is the whole reason
 * this is a shape rather than a string.** A board's league rules resolve to a
 * list of ids (see `./league-scope`), and past `MAX_LEAGUE_IDS` that list is too
 * long for a request line — so it travels as JSON instead. The *key* inlines it
 * regardless, because two league sets that differ are two boards whatever
 * transport carried them, and a key that dropped the ids would serve one board's
 * rows under another's filters.
 *
 * GET and POST are otherwise the same request: identical query string, identical
 * parser at the other end, identical SQL. A caller never chooses; the builders
 * below do, off the size of the scope.
 */
export type AdpRead = {
  /** The request as one normalised string — every parameter, ids included. */
  key: string;
  method: "GET" | "POST";
  search: URLSearchParams;
  body: LeagueScopeBody | null;
};

/** How `/api/adp` spells the two halves of a resolved scope. */
const SCOPE_PARAMS = { include: "league_id", exclude: "xleague_id" } as const;

/**
 * Write a resolved scope onto a query string.
 *
 * `inline` is false only where the ids are about to travel in a body, and only
 * for the *wire* — see {@link AdpRead}. The ids are sorted, which is not
 * cosmetic: unsorted, a key would depend on the order the leagues happened to
 * arrive in, so one rule set becomes two cache entries and two round trips
 * through the same query.
 */
function writeScope(
  params: URLSearchParams,
  scope: LeagueScope,
  inline: boolean,
): void {
  if (!inline || scope.kind === "all") return;
  // An empty include list still writes the parameter — `league_id=` with nothing
  // after it. That is not the same as leaving it out, and the route reads it
  // that way: "the rules matched no league" is a real answer and an empty board,
  // where an absent parameter is no narrowing at all.
  params.set(SCOPE_PARAMS[scope.kind], sortedIds(scope.ids).join(","));
}

/** The key's string for a set of parameters: sorted, so order can't split it. */
function readKey(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

/** A parameter set plus a scope, as the pair of things a caller needs. */
function readFor(params: URLSearchParams, scope: LeagueScope): AdpRead {
  const keyParams = new URLSearchParams(params);
  writeScope(keyParams, scope, true);

  const body = leagueScopeBody(scope);
  writeScope(params, scope, !scopeNeedsBody(scope));

  return {
    key: readKey(keyParams),
    method: body ? "POST" : "GET",
    search: params,
    body,
  };
}

/**
 * The `/api/adp` read for a board. `draft_type` is always sent because a board
 * is never over auctions; `limit` is the board's max so a deep-roster player
 * still gets a number — the tail past 1,000 is beyond any real draft.
 *
 * `today` resolves the relative ranges. `season` is **always** sent, `"all"`
 * included: the route applies its own `DEFAULT_SEASON` only when the caller
 * bounded the board neither by season nor by date, so an omitted season is a
 * default that silently switches off the moment a window is narrowed. Sending
 * it every time is what makes the two cuts compose — the season picks the
 * market, the range picks when inside it — rather than one quietly cancelling
 * the other.
 *
 * The league rules do not appear here as rules. `scope` is their answer,
 * resolved by the caller against the season's crawled leagues, and it is the
 * only thing about them the route ever sees.
 */
export function adpBoardRead(
  controls: AdpControls,
  scope: LeagueScope,
  today: string,
): AdpRead {
  const params = new URLSearchParams();
  params.set("limit", "1000");
  params.set("season", controls.season);

  const { from, to } = rangeBounds(controls.range, today);
  if (from) params.set("start_after", from);
  if (to) params.set("start_before", to);

  // Always snake + linear, and no longer a control. Auction is excluded because
  // its `pick_no` is nomination order rather than a draft slot, so its "ADP" is
  // not one; and snake against linear is a fact about how a room picked, not
  // about the market it priced — the question readers arrived at that chip with
  // was startup against rookie, which is `rounds`. The league type sends
  // nothing either, for the opposite reason: the route answers both boards on
  // every fetch, and which of them is drawn (`controls.boards`) is the
  // display's business, not the query's.
  params.set("draft_type", "snake,linear");

  writeRounds(params, controls.rounds);
  return readFor(params, scope);
}

/** The `rounds_min`/`rounds_max` a draft-kind bucket sends. */
function writeRounds(params: URLSearchParams, rounds: AdpControls["rounds"]): void {
  if (rounds === "all") return;
  const { min, max } = ROUNDS_BOUNDS[rounds];
  if (min !== undefined) params.set("rounds_min", String(min));
  if (max !== undefined) params.set("rounds_max", String(max));
}

/**
 * What makes the drawer's list *a different list* — which players are on it and
 * in what order — as one string.
 *
 * The board's rows are the reader's scroll position: a filter that changes the
 * population or the ranking leaves whatever they were looking at somewhere else
 * entirely, so the list has to go back to the top. Which changes those are is
 * not a judgement call and is deliberately not spelled out here as a list of
 * fields — it is exactly two things, and both are read from their canonical
 * definition rather than re-typed:
 *
 *   - **{@link adpBoardRead}'s key**, which *is* the population: every filter
 *     that narrows which drafts are averaged is in it by construction — the
 *     league rules included, since what the key carries is the ids they resolved
 *     to — so a filter added there resets the scroll without this function being
 *     touched. It also gets the near-misses right: moving from the `all` preset
 *     to a custom window with neither end set resolves to the same bounds, and
 *     two different rule sets that leave the same leagues resolve to the same
 *     ids, so the string is unchanged and the reader keeps their place.
 *   - **`boards`**, the one *display* selection that is not merely a display
 *     selection: {@link adpBoardRows} drops the rows a single board can't
 *     average and re-sorts on that board's column, so pressing a board key is a
 *     different list at a different order.
 *
 * The **steepness is deliberately absent**, which is the whole reason this is a
 * function rather than the query string alone. It converts an averaged ADP into
 * draft capital and reorders nothing, and it is dragged a notch at a time while
 * the reader watches one player's value bend — yanking the list to the top under
 * that hand is exactly the bug this exists to avoid.
 */
export function adpListIdentity(
  controls: AdpControls,
  scope: LeagueScope,
  today: string,
): string {
  return `${adpBoardRead(controls, scope, today).key}|boards=${controls.boards}`;
}

/**
 * The read that prices a *roster* off the same board: the card's team value, and
 * the expanded panel's two value columns.
 *
 * The Leagues tab's team value used to take only the steepness off this drawer,
 * so the panel could be narrowed to startup drafts while every card went on
 * being priced off every draft crawled. It reads the whole board now — but not
 * by sending {@link adpBoardRead}'s own parameters, because two things must not
 * cross:
 *
 *   - **`scoring` and `superflex` stay per league**, resolved server-side by
 *     `adpBoardFor` from the league's own settings. A superflex roster priced
 *     off 1QB drafts is wrong at *every* position, not just at quarterback (the
 *     lesson KTC's two boards already taught). They are not sent from here at
 *     all — they never were, and now they are not even expressible: the drawer's
 *     chips for both are league *rules*, and a rule set narrows which leagues'
 *     drafts are on the board without saying anything about which board a given
 *     roster reads. The arrow between a league and those two runs the other way,
 *     which is what {@link seedFromLeague} is.
 *   - **The season travels as `board_season`**, not `season`. Every route under
 *     `/api/user/[username]` reads `?season` as *which season's leagues are on
 *     screen* — it picks the rosters to price and the weeks to project — so the
 *     board reusing that name would mean moving the drawer to 2024 silently
 *     swapped the card list's rosters out from under it. Two questions, two
 *     names; the route maps one back onto the ADP vocabulary so there is still
 *     only one parser. The name itself comes from `ADP_VALUE_PARAMS`, since a
 *     query string is invisible to the compiler and a rename on one side alone
 *     would leave the board quietly unapplied rather than failing.
 *
 * Everything left is the population the reader chose: the window, the kind of
 * draft, and the leagues their rules resolved to. `draft_type`, `min_picks` and
 * the statuses aren't sent because they are the route's own constants, the same
 * ones {@link adpBoardRead} spells as literals.
 *
 * **It is an {@link AdpRead} rather than a string for the same reason the board
 * is**, and this is the half that made both value routes answer a POST: a
 * narrowed board resolves to more league ids than a request line can carry, and
 * a card priced on a different board from the drawer above it is the exact
 * two-answers-to-one-question this whole path exists to close.
 */
export function adpValueRead(
  controls: AdpControls,
  scope: LeagueScope,
  today: string,
): AdpRead {
  const params = new URLSearchParams();
  params.set(ADP_VALUE_PARAMS.steepness, String(controls.steepness));
  params.set(ADP_VALUE_PARAMS.boardSeason, controls.season);

  const { from, to } = rangeBounds(controls.range, today);
  if (from) params.set("start_after", from);
  if (to) params.set("start_before", to);

  writeRounds(params, controls.rounds);
  return readFor(params, scope);
}
