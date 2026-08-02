import { isSuperflexLineup } from "../../shared/ktc/roster.ts";
import {
  ADP_PEAK,
  DEFAULT_STEEPNESS,
  STEEPNESS_RANGE,
  TYPICAL_STARTING_SLOTS,
  adpValue,
} from "../../shared/manager/adp-value.ts";
import {
  MONTH_ABBREVIATIONS,
  formatRangeDate,
  formatRangeMonth,
  shiftDays,
  shiftMonths,
  todayIso,
} from "../shared/date-range.ts";
import { deriveScoring } from "../shared/league-filters/predicates.ts";
import type { ManagerLeague } from "./types";

// The date primitives moved to `features/shared` once the trades page needed the
// same ones; they are re-exported here because this module's own consumers (the
// drawer, the scrubber, `range-domain`) already import them from it, and one
// canonical definition read under two names is better than two definitions.
// `deriveScoring` went the same way for the same reason — the league filters
// bucket a league by receptions too, and `features/shared` can't import a
// feature, so the definition lives there and this is the second name for it.
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
  /** Sleeper `settings.type`: `"all"`, or 0 redraft / 1 keeper / 2 dynasty. */
  leagueType: "all" | "0" | "1" | "2";
  /** Derived from the league's `scoring_settings.rec`, not stored as such. */
  scoring: "all" | "std" | "half_ppr" | "ppr";
  superflex: "all" | "yes" | "no";
  bestBall: "all" | "yes" | "no";
  /** `"all"`, or an exact team count (`teams_min` = `teams_max`). */
  teams: "all" | string;
  /**
   * The draft's round count, bucketed — which is to say *what kind of draft* it
   * was: a rookie draft's pick 1 and a startup's pick 1 are different games, the
   * doc's own example, so the board can split the short rookie drafts from the
   * full ones rather than average across them. It is offered under those names
   * rather than as a round count, because the round count is the evidence and
   * the kind of draft is the question.
   */
  rounds: "all" | "rookie" | "full";
  /**
   * How top-heavy the ADP → team-value curve is on the Leagues tab, as the
   * number of times value halves across a league's startable pool. Unlike every
   * field above it, this doesn't narrow *which drafts* are averaged — it sets how
   * a player's ADP converts into value once averaged, so it rides on the
   * per-player board (which is a raw number) doing nothing and drives the
   * league-card team value instead.
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
};

export type AdpRangePreset = "30d" | "90d" | "12m" | "all" | "custom";

/**
 * The presets, in the order the drawer offers them. Two labels each: `label`
 * names the range where it stands alone (the trigger, the drawer's header), and
 * `chip` is what the row reads — dropping "Last" is what keeps that row on one
 * line at the drawer's width, and inside the row the word is implied by the
 * "Drafted" label anyway. `12 mo` is abbreviated a step further because the
 * four are laid out as equal segments: on a phone they are ~72px each, which
 * "12 months" wraps to two lines in and takes the whole row's height with it.
 *
 * `custom` is deliberately **not** on this list, though it is still a preset
 * value. It used to be a fifth chip that revealed two date inputs; the range
 * scrubber replaced them, so a custom window is now what you get by moving a
 * handle or taking a marker rather than a mode you enter first. The chips fly
 * the handles somewhere, which is why the relative ones keep earning their place
 * — "Last 90 days" stays true tomorrow, where the dates behind it would not.
 */
export const ADP_RANGE_PRESETS: AdpRangePresetOption[] = [
  { value: "30d", label: "Last 30 days", chip: "30 days" },
  { value: "90d", label: "Last 90 days", chip: "90 days" },
  { value: "12m", label: "Last 12 months", chip: "12 mo" },
  { value: "all", label: "All time", chip: "All time" },
];

export type AdpRangePresetOption = {
  value: AdpRangePreset;
  label: string;
  chip: string;
};

/**
 * The presets worth offering for a given season, which is not the same list
 * every time.
 *
 * A relative preset is measured back from today, so it only means something on a
 * board that can *contain* today: "the last 30 days" of the 2024 season is an
 * empty board, and offering a chip that reliably returns nothing is worse than
 * not offering it. Twelve months goes further — inside a single season it is
 * the whole season with extra steps, so it survives only on the all-seasons
 * board where it is a real cut.
 *
 * What is left for a past season is one chip, and a row of one is no choice at
 * all — the caller drops the row and lets the strip and its calendar markers be
 * the control, which is what they were for.
 */
export function adpRangePresets(
  season: string,
  currentSeason: string,
): AdpRangePresetOption[] {
  const unbounded: AdpRangePresetOption =
    season === "all"
      ? { value: "all", label: "All time", chip: "All time" }
      : { value: "all", label: `All of ${season}`, chip: `All ${season}` };

  if (season === "all") return [...ADP_RANGE_PRESETS.slice(0, 3), unbounded];
  const relative = ADP_RANGE_PRESETS.filter((p) => p.value === "30d" || p.value === "90d");
  return season === currentSeason ? [unbounded, ...relative] : [unbounded];
}

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
export function previewAdpPool(teams: AdpControls["teams"]): number {
  const count = teams === "all" ? 12 : Number(teams);
  return (Number.isFinite(count) && count > 0 ? count : 12) * TYPICAL_STARTING_SLOTS;
}

/** A board row's draft-capital value under the drawer's current curve. */
export function previewAdpValue(
  adp: number,
  teams: AdpControls["teams"],
  steepness: number,
): number {
  return adpValue(adp, previewAdpPool(teams), steepness);
}

/** The `rounds_min`/`rounds_max` bounds each rounds bucket sends. */
const ROUNDS_BOUNDS: Record<"rookie" | "full", { min?: number; max?: number }> = {
  // Rookie drafts are a handful of rounds; startups and redrafts fill a roster.
  // The gap between is left to "all" rather than claimed by either side.
  rookie: { max: 5 },
  full: { min: 12 },
};

/** The `league_type` name `/api/adp` expects for each Sleeper `settings.type`. */
const LEAGUE_TYPE_NAME: Record<"0" | "1" | "2", string> = {
  "0": "redraft",
  "1": "keeper",
  "2": "dynasty",
};

/**
 * The starting board: one season of drafts, whole, both meaningful draft types
 * (snake + linear), no league narrowing.
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
    leagueType: "all",
    scoring: "all",
    superflex: "all",
    bestBall: "all",
    teams: "all",
    rounds: "all",
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
  }
}

/**
 * What the range says on the trigger and in the drawer's header. A preset keeps
 * its name — "Last 90 days" stays true as time passes, where the dates behind it
 * would have to be re-read — and only a custom window spells its dates out.
 */
export function rangeLabel(range: AdpRange): string {
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
    (range.preset === "custom" && range.from === null && range.to === null)
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
 * Fill the league-setting controls from one of the manager's leagues — the
 * "associated league setting" shortcut. It sets what a league payload carries:
 * type, scoring, best ball, size and — since the leagues stream started sending
 * `roster_positions` for the league filters — whether it starts more than one
 * quarterback. `range` and `rounds` are left as they were: neither is a league
 * setting — when a draft happened and what kind of draft it was are facts about
 * the room, not about the league it filled.
 *
 * Superflex was the one league setting this couldn't seed, and it is the one that
 * moves a board most: a superflex population prices quarterbacks like first-round
 * assets, so "match a league" that left it alone could hand a two-QB league the
 * board it is least like. It reads the same predicate `/api/adp` classifies
 * stored leagues with, so the seeded filter lands on the population the league
 * itself belongs to.
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
  // Sleeper omits `type` for standard redraft leagues; a non-number is redraft.
  const typeRaw = settings.type;
  const typeNum = typeof typeRaw === "number" ? typeRaw : 0;
  const leagueType: AdpControls["leagueType"] =
    typeNum === 1 ? "1" : typeNum === 2 ? "2" : "0";

  return {
    ...controls,
    season: league.season,
    leagueType,
    scoring: deriveScoring(league.scoring_settings),
    superflex: isSuperflexLineup(league.roster_positions) ? "yes" : "no",
    bestBall: settings.best_ball === 1 ? "yes" : "no",
    teams: String(league.total_rosters),
  };
}

/**
 * The `/api/adp` query string for a board. An `"all"` control is left out so the
 * route's tri-state parser reads it as "don't narrow"; `draft_type` is always
 * sent because a board is never over auctions. `limit` is the board's max so a
 * deep-roster player still gets a number — the tail past 1,000 is beyond any
 * real draft.
 *
 * `today` resolves the relative ranges. `season` is **always** sent, `"all"`
 * included: the route applies its own `DEFAULT_SEASON` only when the caller
 * bounded the board neither by season nor by date, so an omitted season is a
 * default that silently switches off the moment a window is narrowed. Sending
 * it every time is what makes the two cuts compose — the season picks the
 * market, the range picks when inside it — rather than one quietly cancelling
 * the other.
 */
export function adpQueryString(controls: AdpControls, today: string): string {
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
  // was startup against rookie, which is `rounds`.
  params.set("draft_type", "snake,linear");

  if (controls.leagueType !== "all") {
    params.set("league_type", LEAGUE_TYPE_NAME[controls.leagueType]);
  }
  if (controls.scoring !== "all") params.set("scoring", controls.scoring);
  if (controls.superflex !== "all") {
    params.set("superflex", controls.superflex === "yes" ? "1" : "0");
  }
  if (controls.bestBall !== "all") {
    params.set("best_ball", controls.bestBall === "yes" ? "1" : "0");
  }
  if (controls.teams !== "all") {
    params.set("teams_min", controls.teams);
    params.set("teams_max", controls.teams);
  }
  if (controls.rounds !== "all") {
    const { min, max } = ROUNDS_BOUNDS[controls.rounds];
    if (min !== undefined) params.set("rounds_min", String(min));
    if (max !== undefined) params.set("rounds_max", String(max));
  }

  return params.toString();
}
