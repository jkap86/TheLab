/**
 * What varies the two expensive server-side reads, what they are keyed by, and
 * how long an answer is kept.
 *
 * **Keys and policy only — the caches themselves live beside the reads they
 * hold**, `getDraftAdp` in `./adp.ts` and `readManagerRanks` in
 * `./ranks-read.ts`. That split is what makes this module pure: everything it
 * touches from either arrives as an erased `import type`, so the keys can be
 * driven by Node's test runner with nothing behind them — the same bar
 * `adp-filters` and `rank` hold, and for the same reason. A cache key is exactly
 * the kind of thing that is wrong silently: too narrow and one board's answer is
 * served under another's filters, too wide and the cache never hits, and neither
 * shows up as an error.
 *
 * **Both keys name every input the answer varies on, spelled out rather than
 * `JSON.stringify(value)`.** Serialising an object straight puts its *property
 * order* in the key, so a filters object assembled field-by-field somewhere else
 * would miss against an identical one from the parser. Writing the fields into a
 * fixed-order array makes the key a fact about the values.
 *
 * The list fields are sorted and deduplicated on the way in, which is
 * normalisation rather than tidying: `= ANY(…)` and `<> ALL(…)` are set
 * comparisons, so `["snake","linear"]` and `["linear","snake"]` are one
 * population, and a key that told them apart would compute the same board twice.
 * The ids go in **verbatim rather than digested**, for the reason `boardSignature`
 * spells its league scope out: a hash trades a silent collision for a shorter
 * key, and a collision here is one reader's board served to another with nothing
 * to say so.
 */

import { booleanFilter } from "../query/parse.ts";

import type { AdpFilters } from "./adp-filters.ts";

/**
 * How long a full ADP board is worth reusing, and how many are kept.
 *
 * **Ten minutes, the same TTL as the per-player board next to it** — and for the
 * same reason, which is what writes underneath: the league crawler, whose
 * fastest tier is fifteen minutes and whose effect on any one board is a handful
 * of new drafts among thousands. It is deliberately *shorter* than the browser's
 * own `ADP_STALE_TIMES.board` (fifteen minutes), keeping the house rule that a
 * layer's TTL is shorter than the one it stands in front of: a stale client read
 * costs a request this answers from memory, where a stale read here would cost a
 * second of aggregate over ~1.5M picks.
 *
 * The bound is in *boards*, and a board is the largest entry any cache in this
 * app holds — the drawer asks for `limit=1000`, so one entry is a thousand rows
 * carrying two five-number board splits each, a few hundred kilobytes. Sixteen
 * is a few megabytes at the worst case and far more than the working set: the
 * population is the same for every reader who has not narrowed it, so the
 * default board is *one* key however many people are reading it, and the
 * distinct entries are the handful of seasons, windows and league-rule sets in
 * play at once. Eviction is recency, so the reader who has stopped scrolling
 * loses their board to the one who hasn't.
 */
export const ADP_BOARD_CACHE = {
  name: "adp-board",
  ttlMs: 10 * 60 * 1000,
  max: 16,
} as const;

/**
 * How long a manager's ranks are worth reusing, and how many managers are kept.
 *
 * **Five minutes, matching `MANAGER_STALE_TIMES.ranks`** — the browser's own
 * freshness for this route, and the shortest of the manager reads because the
 * projections behind it can move hourly. What that buys is the case the browser
 * cache cannot reach: a second reader, a second tab, a reload, and the boundary
 * where one browser's entry goes stale all land on a payload that costs a lineup
 * solve per team per remaining week across every league the manager plays in —
 * thousands of solves for a large account, none of which the previous reader's
 * cache entry can be shared with.
 *
 * An entry is small — one rank set per league, so a hundred-odd short objects —
 * so the bound is generous: sixty-four managers is a few megabytes and covers
 * every account a single process is likely to be asked about inside a
 * five-minute window.
 */
export const MANAGER_RANKS_CACHE = {
  name: "manager-ranks",
  ttlMs: 5 * 60 * 1000,
  max: 64,
} as const;

/**
 * How long one league's **core** detail is worth reusing, and how many leagues
 * are kept.
 *
 * **Three minutes, against the browser's five** — the house rule that a layer's
 * TTL is shorter than the one it stands in front of, so a client entry going
 * stale costs a request this answers from memory rather than four queries. It is
 * also comfortably shorter than the crawler's fastest tier (fifteen minutes),
 * which is what makes staleness bounded by something already true of the data
 * rather than by this cache.
 *
 * What it protects is not one reader — the browser cache does that — but the
 * case the browser cannot reach: a second tab, a second reader, a reload, a
 * process that has just restarted, and (new here) the **three enrichment routes
 * beside it**, each of which needs the same league, rosters and settings to do
 * its own work. Splitting one payload into four requests would otherwise have
 * multiplied that read by four; cached, the split costs one.
 *
 * An entry is a dozen rosters, their members and their picks — tens of
 * kilobytes — so 256 leagues is a handful of megabytes and far more than the
 * working set of a single process inside three minutes.
 *
 * **It is invalidated on write as well as by time**, which the other two caches
 * here have no need of: this is the one read a *reader* can force a refresh of
 * (the lineup checker's sync key), and a panel that re-read a three-minute-old
 * roster straight after Sleeper confirmed the change would make that key look
 * broken. See `invalidateLeagueDetail`.
 */
export const LEAGUE_DETAIL_CACHE = {
  name: "league-detail",
  ttlMs: 3 * 60 * 1000,
  max: 256,
} as const;

/**
 * Which ranks a request wants — the one option that changes the *work* rather
 * than only the answer.
 *
 * `projections: false` skips the weekly lineup solves entirely, which is the
 * whole cost of this route; see {@link readManagerRanks}. It is in the key
 * because the two answers genuinely differ: the cheap one carries no `weeks` and
 * a null `proj`/`proj_bench` on every league, and serving that to a caller
 * asking for the full one would blank two columns with nothing to say why.
 */
export type ManagerRanksOptions = {
  /** Compute the projected starter and bench ranks. */
  projections: boolean;
};

/**
 * `?projections=` off a ranks request — **defaulting to on**.
 *
 * The default is the compatibility half and is not negotiable: a bookmark, an
 * older client or anything else that omits the parameter has to get the payload
 * it has always got, so the *caller* opts out of work rather than opting into
 * it. `booleanFilter` rather than `booleanFlag` for exactly that reason — the
 * flag primitive reads an absent key as `false`, which is the opposite meaning,
 * and the two spellings being separate functions is what keeps that from being
 * a silent choice (see `shared/query/parse`).
 *
 * A junk value is refused rather than falling back to the default: `?projections=maybe`
 * is a caller that believes it has turned something off.
 */
export function parseManagerRanksOptions(
  params: URLSearchParams,
): { ok: true; options: ManagerRanksOptions } | { ok: false; error: string } {
  const parsed = booleanFilter(params, "projections");
  if (!parsed.ok) return parsed;
  return { ok: true, options: { projections: parsed.value ?? true } };
}

/**
 * The cache key for one ADP board.
 *
 * Every field of {@link AdpFilters} appears, because the query is a pure
 * function of precisely those and nothing else: the draft/league `WHERE` is
 * built from the first fourteen, `min_picks` gates which players come back, and
 * `limit`/`offset` decide the page. `adp-filters.test.ts` pins that agreement
 * field by field, which is the assertion no type can carry — a filter added to
 * the type and forgotten here would serve one board's page under another's
 * filters.
 */
export function adpBoardCacheKey(filters: AdpFilters): string {
  return JSON.stringify([
    sorted(filters.seasons),
    filters.start_after,
    filters.start_before,
    sorted(filters.draft_types),
    sorted(filters.draft_statuses),
    sorted(filters.league_ids),
    sorted(filters.exclude_league_ids),
    sorted(filters.scoring),
    filters.best_ball,
    filters.superflex,
    filters.rounds_min,
    filters.rounds_max,
    filters.teams_min,
    filters.teams_max,
    filters.min_picks,
    filters.limit,
    filters.offset,
  ]);
}

/**
 * The cache key for one manager's ranks.
 *
 * **Keyed on the canonical Sleeper id rather than the searched name**, which is
 * the whole reason the route resolves before it reads: `Jkap` and `jkap` are one
 * account, and keying on what was typed would compute the same thousands of
 * lineup solves once per spelling. The season is a separate segment because it
 * selects a different set of rosters *and* a different set of projections, and
 * the option because it selects a different amount of work.
 */
export function managerRanksCacheKey(
  userId: string,
  season: string,
  options: ManagerRanksOptions,
): string {
  return JSON.stringify([userId, season, options.projections]);
}

/**
 * A list as the key spells it: sorted and deduplicated, or null left as null.
 *
 * Null is not the same answer as `[]` anywhere in {@link AdpFilters} — an absent
 * `league_ids` narrows nothing where an empty one is rules that matched no
 * league — so the two must not collapse into each other here either.
 */
function sorted<T extends string>(values: readonly T[] | null): T[] | null {
  return values === null ? null : [...new Set(values)].sort();
}
