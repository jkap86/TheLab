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
 * The starting board: one season of drafts, whole, every meaningful draft type
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
 * season, type, scoring, best ball and size. `range`, `draftType` and
 * `superflex` are left as they were: the first two aren't league settings, and
 * superflex lives in `roster_positions`, which the client league doesn't carry,
 * so it stays a deliberate manual choice.
 *
 * The season is seeded, unlike the range beside it, because it *is* a league
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
