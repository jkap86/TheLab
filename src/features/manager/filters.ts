import { isSuperflexLineup } from "../../shared/ktc/roster.ts";
import { IDP_SLOTS } from "../../shared/projections/slots.ts";
import { deriveScoring } from "./adp-controls.ts";
import type { ManagerLeague } from "./types";

/**
 * League list filtering. Kept apart from the control that renders it so the
 * matching rules — which encode Sleeper's settings quirks — can be read and
 * tested on their own.
 *
 * Three of the seven filters read something other than the `settings` blob, and
 * each borrows the predicate that already owns the question rather than writing
 * a second one: `isSuperflexLineup` (the same slot walk that picks a league's
 * KTC board), `IDP_SLOTS` (derived from the solver's own vocabulary), and
 * `deriveScoring` (the buckets `/api/adp` groups by). Those come in relatively
 * with an explicit `.ts` extension for the reason the tests do — Node's test
 * runner strips types but doesn't know the `@/*` aliases — and each is free of
 * runtime imports beyond the slot table, so none of them drags `pg` into the
 * bundle.
 */

export type LeagueFilters = {
  /** Sleeper `settings.type`: "all" or a stringified 0=redraft, 1=keeper, 2=dynasty. */
  type: "all" | "0" | "1" | "2";
  /** Sleeper `settings.best_ball`: "all", or filter by best-ball on/off. */
  bestBall: "all" | "yes" | "no";
  /** Where the league is in its season — see {@link LIVE_STATUSES}. */
  status: "all" | "pre_draft" | "drafting" | "in_season" | "done";
  /** Whether the lineup starts more than one QB, per `roster_positions`. */
  superflex: "all" | "yes" | "no";
  /** Whether the lineup starts individual defenders, per `roster_positions`. */
  idp: "all" | "yes" | "no";
  /** The reception bucket derived from `scoring_settings.rec`. */
  scoring: "all" | "std" | "half_ppr" | "ppr";
  /** Whether tight ends are paid a per-reception bonus. */
  tePremium: "all" | "yes" | "no";
};

export const DEFAULT_LEAGUE_FILTERS: LeagueFilters = {
  type: "all",
  bestBall: "all",
  status: "all",
  superflex: "all",
  idp: "all",
  scoring: "all",
  tePremium: "all",
};

/**
 * The options each filter offers, in the order they're shown.
 *
 * They live here rather than in the control that renders them because the
 * vocabulary is now read in two places — the modal's buttons and
 * {@link filterSummary}, which names the active selection outside it. A modal
 * hides its own state, so the words on the header have to come from the same
 * table as the words in the dialog or the two drift into disagreeing about what
 * `bestBall: "no"` is called.
 */
export const TYPE_OPTIONS: { value: LeagueFilters["type"]; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "0", label: "Redraft" },
  { value: "1", label: "Keeper" },
  { value: "2", label: "Dynasty" },
];

export const BEST_BALL_OPTIONS: {
  value: LeagueFilters["bestBall"];
  label: string;
}[] = [
  { value: "all", label: "All formats" },
  { value: "yes", label: "Best ball" },
  { value: "no", label: "Lineup" },
];

export const STATUS_OPTIONS: {
  value: LeagueFilters["status"];
  label: string;
}[] = [
  { value: "all", label: "Any status" },
  { value: "pre_draft", label: "Pre-draft" },
  { value: "drafting", label: "Drafting" },
  { value: "in_season", label: "In season" },
  { value: "done", label: "Complete" },
];

export const SUPERFLEX_OPTIONS: {
  value: LeagueFilters["superflex"];
  label: string;
}[] = [
  { value: "all", label: "Any lineup" },
  { value: "yes", label: "Superflex" },
  { value: "no", label: "One QB" },
];

export const IDP_OPTIONS: { value: LeagueFilters["idp"]; label: string }[] = [
  { value: "all", label: "Any defense" },
  { value: "yes", label: "IDP" },
  { value: "no", label: "Offense only" },
];

export const SCORING_OPTIONS: {
  value: LeagueFilters["scoring"];
  label: string;
}[] = [
  { value: "all", label: "Any scoring" },
  { value: "ppr", label: "PPR" },
  { value: "half_ppr", label: "Half PPR" },
  { value: "std", label: "Standard" },
];

export const TE_PREMIUM_OPTIONS: {
  value: LeagueFilters["tePremium"];
  label: string;
}[] = [
  { value: "all", label: "Any TE scoring" },
  { value: "yes", label: "TE premium" },
  { value: "no", label: "No TE premium" },
];

/**
 * Every filter as `(key, options)`, in the order the dialog lays them out.
 *
 * The two readouts below walk this rather than naming each field, so a filter
 * added above is counted and summarised without a second and third edit — which
 * is how the count on the trigger and the words on the header came to be worth
 * one table in the first place.
 */
const FILTERS: {
  [K in keyof LeagueFilters]: { key: K; options: { value: LeagueFilters[K]; label: string }[] };
}[keyof LeagueFilters][] = [
  { key: "status", options: STATUS_OPTIONS },
  { key: "type", options: TYPE_OPTIONS },
  { key: "bestBall", options: BEST_BALL_OPTIONS },
  { key: "superflex", options: SUPERFLEX_OPTIONS },
  { key: "idp", options: IDP_OPTIONS },
  { key: "scoring", options: SCORING_OPTIONS },
  { key: "tePremium", options: TE_PREMIUM_OPTIONS },
];

/** How many filters are narrowing the list — the count on the modal's trigger. */
export function activeFilterCount(filters: LeagueFilters): number {
  return FILTERS.filter(({ key }) => filters[key] !== "all").length;
}

/**
 * The active selection in words, e.g. `"dynasty · lineup"` or `"all leagues"`.
 *
 * With the controls behind a modal, this is the only thing on the page saying
 * what the header's record and win pct are counted over — so it names the
 * *scope* of those numbers rather than decorating the trigger button.
 *
 * Lower case because it is read mid-sentence ("counting dynasty · lineup"),
 * where the buttons' own capitalised labels read as proper nouns. Same table
 * either way, so a renamed option can't say two different things.
 */
export function filterSummary(filters: LeagueFilters): string {
  const parts = FILTERS.flatMap(({ key, options }) => {
    const value = filters[key];
    if (value === "all") return [];
    const label = options.find((o) => o.value === value)?.label;
    return label ? [label.toLowerCase()] : [];
  });
  return parts.length ? parts.join(" · ") : "all leagues";
}

/** Read a numeric field out of a league's Sleeper `settings` blob. */
function settingNumber(league: ManagerLeague, key: string): number | undefined {
  const value = league.settings?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * A league's Sleeper type as a number: 0 redraft, 1 keeper, 2 dynasty.
 *
 * Sleeper omits `type` for standard redraft leagues, so a missing value is 0 —
 * the same assumption `/api/adp` makes in SQL, and the reason this is a function
 * rather than a field read at each call site: the share cards count dynasty and
 * redraft leagues off it too, and a second copy of the fallback is a second
 * chance to forget it.
 */
export function leagueType(league: ManagerLeague): number {
  return settingNumber(league, "type") ?? 0;
}

/**
 * The statuses a league is still *running* under, in the order it passes through
 * them. The Complete option is their complement rather than a match on
 * `"complete"`: an end-of-season spelling this list doesn't know would otherwise
 * be reachable under "Any status" alone — visible in the total, in none of the
 * buckets, which reads as a filter losing leagues.
 */
const LIVE_STATUSES = new Set(["pre_draft", "drafting", "in_season"]);

/**
 * Whether a league starts individual defenders. Read off the slot vocabulary,
 * so `IDP_FLEX` and a bare `LB` both count and a new IDP slot counts the moment
 * the solver learns it.
 *
 * A league whose slots aren't stored answers no, the same way the rest of the
 * app treats an unknown lineup — see {@link isSuperflexLineup}. That keeps the
 * two sides of the filter summing to the list rather than quietly dropping a
 * league from both.
 */
export function hasIdpSlots(league: ManagerLeague): boolean {
  return (league.roster_positions ?? []).some((slot) => IDP_SLOTS.has(slot));
}

/**
 * Whether tight ends are paid a bonus per reception. `bonus_rec_te` is where
 * Sleeper keeps TE premium — it rides *on top of* `rec`, so it is a fact about
 * the league independent of which reception bucket {@link deriveScoring} puts it
 * in, which is why the two are separate filters rather than extra buckets in one.
 *
 * Any positive bonus counts: half a point and a full point are both premium, and
 * bucketing the size of it would split a population that is small to begin with.
 */
export function hasTePremium(league: ManagerLeague): boolean {
  const bonus = league.scoring_settings?.bonus_rec_te;
  return typeof bonus === "number" && bonus > 0;
}

/** Whether a league passes the active filters. */
export function matchesFilters(
  league: ManagerLeague,
  filters: LeagueFilters,
): boolean {
  if (filters.type !== "all") {
    if (leagueType(league) !== Number(filters.type)) return false;
  }
  if (filters.bestBall !== "all") {
    const isBestBall = settingNumber(league, "best_ball") === 1;
    if (filters.bestBall === "yes" ? !isBestBall : isBestBall) return false;
  }
  if (filters.status !== "all") {
    const matches =
      filters.status === "done"
        ? !LIVE_STATUSES.has(league.status)
        : league.status === filters.status;
    if (!matches) return false;
  }
  if (filters.superflex !== "all") {
    const superflex = isSuperflexLineup(league.roster_positions);
    if (filters.superflex === "yes" ? !superflex : superflex) return false;
  }
  if (filters.idp !== "all") {
    const idp = hasIdpSlots(league);
    if (filters.idp === "yes" ? !idp : idp) return false;
  }
  if (filters.scoring !== "all") {
    if (deriveScoring(league.scoring_settings) !== filters.scoring) return false;
  }
  if (filters.tePremium !== "all") {
    const premium = hasTePremium(league);
    if (filters.tePremium === "yes" ? !premium : premium) return false;
  }
  return true;
}
