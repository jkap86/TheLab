import type { ManagerLeague } from "@/shared/contract";

import { matchesFilters } from "../shared/league-filters/predicates.ts";
import type { LeagueFilters } from "../shared/league-filters/types.ts";

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
 * It lives in this feature rather than in `features/shared` because there is
 * one reader: TheLabX moved it out when its ADP board became a second one, and
 * that board is not ported. It resolves and *sizes* a scope and never spells
 * one — the parameter names are `trade-query`'s business.
 *
 * The predicates are deep-imported relatively with an explicit extension, the
 * mechanism this module's own test needs: Node's runner resolves neither the
 * `@/*` aliases nor the shared barrel.
 */

/** How the league rules are sent: the smaller of the two lists, or neither. */
export type LeagueScope =
  | { kind: "all" }
  | { kind: "include"; ids: string[] }
  | { kind: "exclude"; ids: string[] };

/** Nothing narrowed, as a shared value so a default prop keeps its identity. */
export const ALL_LEAGUES: LeagueScope = { kind: "all" };

/**
 * TheLabX carries a `MAX_LEAGUE_IDS` here and a POST-body form beside it, for a
 * scope whose shorter list is past ~500 ids — ~10KB on a request line, which
 * several proxies refuse with a 414. Neither is ported: this corpus is fed by
 * manager lookups rather than a crawler, so the population cannot reach it.
 * What must **not** come back if it ever does is that threshold's older
 * meaning, where the page gave up narrowing and filtered pages in the browser:
 * a first page whose trades all came from excluded leagues rendered as an empty
 * board, which unmounts the list, which is what would have asked for page two.
 */

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
 * A scope's ids, sorted.
 *
 * Not cosmetic: an unsorted list makes a cache key depend on the order the
 * leagues happened to arrive in, so one filter set becomes two entries and two
 * round trips through the same query. The same reason `/api/adp`'s key
 * normalises its parameters.
 */
export const sortedIds = (values: readonly string[]): string[] =>
  [...values].sort();
