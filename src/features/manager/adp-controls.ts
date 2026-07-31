import { isSuperflexLineup } from "../../shared/ktc/roster.ts";
import type { ManagerLeague } from "./types";

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
  /** When the drafts happened — see {@link AdpRange}. */
  range: AdpRange;
  /**
   * `"snakelinear"` is the default the route applies when `draft_type` is
   * omitted — auction is left out because its `pick_no` is nomination order, not
   * a draft slot. The three explicit values narrow to one type.
   */
  draftType: "snakelinear" | "snake" | "linear" | "auction";
  /** Sleeper `settings.type`: `"all"`, or 0 redraft / 1 keeper / 2 dynasty. */
  leagueType: "all" | "0" | "1" | "2";
  /** Derived from the league's `scoring_settings.rec`, not stored as such. */
  scoring: "all" | "std" | "half_ppr" | "ppr";
  superflex: "all" | "yes" | "no";
  bestBall: "all" | "yes" | "no";
  /** `"all"`, or an exact team count (`teams_min` = `teams_max`). */
  teams: "all" | string;
  /**
   * The draft's round count, bucketed. A rookie draft's pick 1 and a startup's
   * pick 1 are different games — the doc's own example — so the board can split
   * the short rookie drafts from the full ones rather than average across them.
   */
  rounds: "all" | "rookie" | "full";
  /**
   * How top-heavy the ADP → team-value curve is on the Leagues tab. Unlike every
   * field above it, this doesn't narrow *which drafts* are averaged — it sets how
   * a player's ADP converts into value once averaged, so it rides on the
   * per-player board (which is a raw number) doing nothing and drives the
   * league-card team value instead. A matched string the
   * `/api/user/[username]/adp-value` route parses — the same no-compiler-link
   * pair the board vocabulary is — so a value added here must be added there too.
   */
  steepness: "flat" | "balanced" | "steep";
};

/**
 * The window the board's drafts are taken from, as a preset plus the two dates a
 * custom window carries.
 *
 * A window rather than a season because the two are different cuts of the same
 * drafts: a season is what a draft is *for*, and every dynasty league runs a
 * rookie draft in May and a startup in August under the one label. "The last 30
 * days" is the question a board is usually being asked, and a season can't
 * express it.
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
 * "Drafted" label anyway.
 *
 * `custom` is deliberately **not** on this list, though it is still a preset
 * value. It used to be a fifth chip that revealed two date inputs; the range
 * scrubber replaced them, so a custom window is now what you get by moving a
 * handle or taking a marker rather than a mode you enter first. The chips fly
 * the handles somewhere, which is why the relative ones keep earning their place
 * — "Last 90 days" stays true tomorrow, where the dates behind it would not.
 */
export const ADP_RANGE_PRESETS: { value: AdpRangePreset; label: string; chip: string }[] = [
  { value: "30d", label: "Last 30 days", chip: "30 days" },
  { value: "90d", label: "Last 90 days", chip: "90 days" },
  { value: "12m", label: "Last 12 months", chip: "12 months" },
  { value: "all", label: "All time", chip: "All time" },
];

/**
 * The board's window when the drawer hasn't been touched. Twelve months is wide
 * enough that a quiet stretch of crawling still returns drafts, and narrow
 * enough that last year's board isn't averaged into this year's.
 */
export const DEFAULT_ADP_RANGE: AdpRange = { preset: "12m", from: null, to: null };

/**
 * The curve applied when the ADP bar hasn't been touched. Matches the route's
 * `DEFAULT_STEEPNESS`; the two ends carry the vocabulary separately, so this
 * string is what "balanced" means on the wire. Named so a consumer that needs
 * the default before the controls exist (the Leagues tab, seeding its fetch)
 * reads this rather than retyping the string — a third spelling is a curve
 * change away from the bar pricing one thing and displaying another.
 */
export const DEFAULT_ADP_STEEPNESS: AdpControls["steepness"] = "balanced";

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
 * The starting board: the last twelve months of drafts, every meaningful draft
 * type (snake + linear), no league narrowing.
 *
 * It takes no arguments, unlike the season-seeded default it replaces — which is
 * why the shared store can hold a real selection from the start rather than a
 * null the tabs each fill in once they know the season.
 */
export function defaultAdpControls(): AdpControls {
  return {
    range: DEFAULT_ADP_RANGE,
    draftType: "snakelinear",
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
 * Spelled out rather than left to `Intl`, so a date reads the same in every
 * locale the app is opened in — and so the axis initials the scrubber labels its
 * ticks with are the same list, not a second one that could disagree.
 */
export const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** `2026-06-01` → `Jun 1, 2026`. */
export function formatRangeDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${MONTH_ABBREVIATIONS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

/** `2026-06` → `Jun 2026`. What a bar on the scrubber's axis is. */
export function formatRangeMonth(month: string): string {
  return `${MONTH_ABBREVIATIONS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
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

/** Today where the reader is, as `YYYY-MM-DD` — the argument {@link rangeBounds} wants. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Shift a `YYYY-MM-DD` by whole days, in UTC so no zone can move the boundary. */
export function shiftDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Shift by whole months, keeping the day of the month where one exists. Day 31
 * has no counterpart in a 30-day month, so the result is clamped to that month's
 * last day rather than rolling into the next one — a "last 12 months" window
 * starting on the 1st of the wrong month is a whole month of drafts.
 */
function shiftMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * The scoring bucket a league falls in, from its `rec` points. Mirrors the
 * `SCORING_SQL` the endpoint groups by exactly — absent/unparseable and
 * anything under half a point is standard — so a filter seeded from a league
 * matches the league it came from rather than landing a bucket off.
 */
export function deriveScoring(
  scoring: Record<string, number> | null,
): "std" | "half_ppr" | "ppr" {
  const rec = scoring?.rec;
  if (typeof rec !== "number") return "std";
  if (rec >= 1) return "ppr";
  if (rec >= 0.5) return "half_ppr";
  return "std";
}

/**
 * Fill the league-setting controls from one of the manager's leagues — the
 * "associated league setting" shortcut. It sets what a league payload carries:
 * type, scoring, best ball, size and — since the leagues stream started sending
 * `roster_positions` for the league filters — whether it starts more than one
 * quarterback. `range` and `draftType` are left as they were: they aren't league
 * settings at all.
 *
 * Superflex was the one league setting this couldn't seed, and it is the one that
 * moves a board most: a superflex population prices quarterbacks like first-round
 * assets, so "match a league" that left it alone could hand a two-QB league the
 * board it is least like. It reads the same predicate `/api/adp` classifies
 * stored leagues with, so the seeded filter lands on the population the league
 * itself belongs to.
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
    leagueType,
    scoring: deriveScoring(league.scoring_settings),
    superflex: isSuperflexLineup(league.roster_positions) ? "yes" : "no",
    bestBall: settings.best_ball === 1 ? "yes" : "no",
    teams: String(league.total_rosters),
  };
}

/**
 * The `/api/adp` query string for a board. An `"all"` control is left out so the
 * route's tri-state parser reads it as "don't narrow"; `draftType` is always
 * sent because it always means something. `limit` is the board's max so a
 * deep-roster player still gets a number — the tail past 1,000 is beyond any
 * real draft.
 *
 * `today` resolves the relative ranges, and `season` is never sent: the range
 * replaced it, and sending both would intersect two different cuts of the same
 * drafts. An unbounded range therefore reaches the route as no bound at all,
 * which is what makes "All time" mean it.
 */
export function adpQueryString(controls: AdpControls, today: string): string {
  const params = new URLSearchParams();
  params.set("limit", "1000");

  const { from, to } = rangeBounds(controls.range, today);
  if (from) params.set("start_after", from);
  if (to) params.set("start_before", to);

  params.set(
    "draft_type",
    controls.draftType === "snakelinear" ? "snake,linear" : controls.draftType,
  );

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
