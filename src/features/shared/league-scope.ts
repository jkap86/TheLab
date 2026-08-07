import { matchesFilters } from "./league-filters/predicates.ts";
import type { LeagueFilters } from "./league-filters/types.ts";
import type { ManagerLeague } from "@/shared/manager";

/**
 * The league rules, resolved into something a route can narrow by.
 *
 * **The rules run in the browser and their *answer* crosses the wire**, which is
 * the decision two boards now rest on. They are a slot-group, scoring-key and
 * size engine over Sleeper's JSONB blobs, derived from the solver's own slot
 * tables so a new flex counts the moment the solver learns it; a second
 * implementation in SQL would drift silently, and the symptom would be a filter
 * quietly returning the wrong leagues rather than an error. So there is one
 * implementation, it runs over the league list the dialog already needs for its
 * own per-option counts, and what it sends is a list of ids.
 *
 * It lives here rather than in `features/trades`, where it was written, because
 * the ADP board became its second reader — the mover's usual rule. `trade-query`
 * re-exports it so that page's own consumers keep one import. Nothing about the
 * trades board's use of it changed; what is new is only that the *parameter
 * names* are a caller's business (`/api/trades` reads `leagues`/`xleagues`,
 * `/api/adp` reads `league_id`/`xleague_id`), so this module resolves and sizes
 * a scope and never spells one.
 */

/** How the league rules are sent: the smaller of the two lists, or neither. */
export type LeagueScope =
  | { kind: "all" }
  | { kind: "include"; ids: string[] }
  | { kind: "exclude"; ids: string[] };

/** Nothing narrowed, as a shared value so a default prop keeps its identity. */
export const ALL_LEAGUES: LeagueScope = { kind: "all" };

/**
 * How many league ids will go in a query string before the request switches to
 * carrying them in a POST body instead.
 *
 * At ~19 characters an id plus a separator, 500 is ~10KB on the request line —
 * past what several proxies and CDNs accept, and the failure mode is a 414 that
 * reads as the page being broken. Past it the ids travel as JSON and the route
 * reads them there; nothing else about the request changes, which is the point.
 *
 * **It used to be the point at which the narrowing gave up and moved to the
 * browser, and that was a correctness bug rather than a degradation.** The
 * trades page asked for an *unnarrowed* board and filtered the pages as they
 * arrived, so a first page whose two hundred trades all came from excluded
 * leagues left `visible` empty — which renders the "no trades" note, which
 * unmounts the list, which is what would have asked for page two. The database
 * is where a `WHERE` belongs, and a body is how a long list gets there.
 */
export const MAX_LEAGUE_IDS = 500;

/**
 * Resolve the league rules against a population of leagues.
 *
 * Include or exclude, whichever is shorter, because the two express the same
 * narrowing and a query string has a length: filtering to all but three leagues
 * is three ids, not four hundred. Whichever is chosen, the narrowing is always
 * the server's — how the ids get there is the caller's problem and nothing else's.
 *
 * An empty allowed set is `include: []`, not `all`. The rules matching nothing
 * is a real answer and the honest response to it is an empty board — collapsing
 * it to "no narrowing" would show everything to a reader who asked for none.
 *
 * `active` is what the caller knows and this cannot: whether the reader has
 * narrowed anything at all. With no rules set, every league matches and the
 * scope is `all` by arithmetic — but a population that hasn't *loaded* yet also
 * matches nothing, and answering `include: []` there would blank a board for the
 * beat before the leagues arrive. So a caller with no rules says so.
 */
export function resolveLeagueScope(
  leagues: readonly ManagerLeague[],
  filters: LeagueFilters,
  active: boolean,
): LeagueScope {
  if (!active || leagues.length === 0) return ALL_LEAGUES;

  const allowed: string[] = [];
  const denied: string[] = [];
  for (const league of leagues) {
    if (matchesFilters(league, filters)) allowed.push(league.league_id);
    else denied.push(league.league_id);
  }

  if (denied.length === 0) return ALL_LEAGUES;
  return allowed.length <= denied.length
    ? { kind: "include", ids: allowed }
    : { kind: "exclude", ids: denied };
}

/**
 * Whether this scope's ids are too long to put on a request line — the one
 * thing {@link MAX_LEAGUE_IDS} decides now.
 */
export function scopeNeedsBody(scope: LeagueScope): boolean {
  return scope.kind !== "all" && scope.ids.length > MAX_LEAGUE_IDS;
}

/**
 * The league ids a large scope sends as JSON, spelled as every route reads them.
 *
 * One shape for both boards, unlike the query-string names: a body is JSON this
 * app writes and this app parses, so there is no reason for `/api/adp` and
 * `/api/trades` to disagree about what the two keys are called, and one shape is
 * one server-side parser rather than two.
 */
export type LeagueScopeBody = { leagues?: string[]; xleagues?: string[] };

/** A large scope as that body; null for one that fits on the request line. */
export function leagueScopeBody(scope: LeagueScope): LeagueScopeBody | null {
  if (!scopeNeedsBody(scope) || scope.kind === "all") return null;
  return scope.kind === "include"
    ? { leagues: sortedIds(scope.ids) }
    : { xleagues: sortedIds(scope.ids) };
}

/**
 * A scope's ids, sorted.
 *
 * Not cosmetic: an unsorted list makes a cache key depend on the order the
 * leagues happened to arrive in, so one filter set becomes two entries and two
 * round trips through the same query. The same reason `/api/adp`'s key
 * normalises its parameters.
 */
export const sortedIds = (values: readonly string[]): string[] =>
  [...values].sort();
