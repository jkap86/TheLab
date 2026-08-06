import { matchesFilters } from "../shared/league-filters/predicates.ts";
import type { LeagueFilters } from "../shared/league-filters/types.ts";
import type { ManagerLeague } from "@/shared/manager";

import type { TradeBounds, TradeFilters } from "./filters.ts";

/**
 * The client half of `/api/trades`'s vocabulary: two filter sets and a window,
 * as the query string the route parses.
 *
 * **A matched pair with `shared/trades/params` and no compiler link between
 * them**, the same standing arrangement `/api/adp` and `adp-controls` have: the
 * client writes the parameters the server reads, so a value added on one side
 * and not the other fails as an ignored parameter rather than as a type error.
 * That is why both sides are pure modules with tests, and why the names are
 * spelled identically on both.
 *
 * It is pure and separate from the hooks for the usual reason — it is also what
 * builds the React Query key, and a key derived from anything but the request
 * itself is how two identical requests become two cache entries.
 */

/** How the league rules are sent: the smaller of the two lists, or neither. */
export type LeagueScope =
  | { kind: "all" }
  | { kind: "include"; ids: string[] }
  | { kind: "exclude"; ids: string[] }
  /**
   * Too many ids to put in a query string. The request goes unnarrowed and the
   * page's own residual pass does the narrowing — see `./incremental`, whose
   * three-state accumulator is what makes that cheap.
   */
  | { kind: "client"; allowed: ReadonlySet<string> };

/**
 * How many league ids will go in a query string before the request gives up and
 * narrows on the client instead.
 *
 * At ~19 characters an id plus a separator, 500 is ~10KB on the request line —
 * past what several proxies and CDNs accept, and the failure mode is a 414 that
 * reads as the page being broken. It is a generous bound: a database holding
 * more than 500 leagues *with trades in one season* has other things to worry
 * about, and the fallback is correct anyway.
 */
export const MAX_LEAGUE_IDS = 500;

/**
 * Resolve the league rules against the season's leagues.
 *
 * **The rules run here and not in SQL**, which is the decision the whole design
 * rests on: they are a slot-group and scoring-key engine over Sleeper's JSONB
 * blobs, derived from the solver's own slot tables so a new flex counts the
 * moment the solver learns it, and a second implementation in the database would
 * drift silently — the symptom being a filter that quietly returns the wrong
 * leagues. So the client evaluates them over the league list it already needs
 * for the dialog's counts, and sends the *answer*.
 *
 * Include or exclude, whichever is shorter, because the two express the same
 * narrowing and a query string has a length: filtering to all but three leagues
 * is three ids, not four hundred.
 *
 * An empty allowed set is `include: []`, not `all`. The rules matching nothing
 * is a real answer and the honest response to it is an empty board — collapsing
 * it to "no narrowing" would show every trade to a reader who asked for none.
 */
export function resolveLeagueScope(
  leagues: readonly ManagerLeague[],
  filters: LeagueFilters,
  active: boolean,
): LeagueScope {
  if (!active || leagues.length === 0) return { kind: "all" };

  const allowed: string[] = [];
  const denied: string[] = [];
  for (const league of leagues) {
    if (matchesFilters(league, filters)) allowed.push(league.league_id);
    else denied.push(league.league_id);
  }

  if (denied.length === 0) return { kind: "all" };
  if (Math.min(allowed.length, denied.length) > MAX_LEAGUE_IDS) {
    return { kind: "client", allowed: new Set(allowed) };
  }
  return allowed.length <= denied.length
    ? { kind: "include", ids: allowed }
    : { kind: "exclude", ids: denied };
}

/** Everything a trades request is narrowed by, before it becomes a string. */
export type TradeRequest = {
  season: string;
  scope: LeagueScope;
  filters: TradeFilters;
  bounds: TradeBounds;
  /**
   * The reader's resolved Sleeper account, or null where none is stored — what
   * `filters.circle` is drawn around.
   *
   * It sits beside the filters rather than inside them because it is not one: it
   * is *who is asking*, and the page reads it out of the account store the tools
   * page writes. A circle with nobody at the centre of it is not sent at all
   * (see {@link tradeQueryParams}), so the board a reader with no account sees is
   * the unnarrowed one rather than an empty one.
   */
  user: string | null;
};

/**
 * The query string for one request, with `cursor` and `limit` left to the
 * caller — those are pagination rather than narrowing, and leaving them out is
 * what lets {@link tradeQueryKey} be this same string.
 *
 * Ids are sorted before joining. That is not cosmetic: an unsorted list makes
 * the key depend on the order the leagues happened to arrive in, so the same
 * filter set becomes two cache entries and two round trips through the same
 * query. The same reason `/api/adp`'s key normalises its parameters.
 */
export function tradeQueryParams(request: TradeRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set("season", request.season);

  const { scope } = request;
  if (scope.kind === "include") params.set("leagues", join(scope.ids));
  else if (scope.kind === "exclude") params.set("xleagues", join(scope.ids));

  // Both or neither. The server forces the circle open when there is no user, so
  // sending one without the other would only make the key differ between a
  // request and the identical board it resolves to — and the account arrives a
  // render *after* the first paint (the store has no server snapshot), so the
  // pair being absent together is the ordinary opening state rather than a bug.
  const { circle } = request.filters;
  if (circle !== "all" && request.user) {
    params.set("circle", circle);
    params.set("user", request.user);
  }

  const { from, to } = request.bounds;
  if (from !== null) params.set("from", String(from));
  if (to !== null) params.set("to", String(to));

  // The bays, indexed. An empty one contributes nothing at all — the server
  // drops empty sides anyway, and a parameter that says "this bay is empty" is a
  // key segment that splits the cache between two identical boards.
  request.filters.sides.forEach((side, index) => {
    const prefix = `s${index + 1}`;
    if (side.manager) params.set(`${prefix}manager`, side.manager);
    if (side.players.length) params.set(`${prefix}players`, join(side.players));
    if (side.picks.length) params.set(`${prefix}picks`, join(side.picks));
  });

  // Only sent when it can change an answer. The mode reads *within* a bay, so
  // what makes it matter is one bay holding two assets — not two assets on the
  // board, which under the sides is a relation rather than a set.
  const graded = request.filters.sides.some(
    (side) => side.players.length + side.picks.length > 1,
  );
  if (graded) params.set("match", request.filters.match);

  return params;
}

/**
 * The cache key for a request: its query string, normalised.
 *
 * A string rather than the object it came from, because React Query hashes keys
 * structurally and two structurally different objects describing the same
 * request would be two entries — which for this route is the difference between
 * a scroll position kept and a board re-read.
 */
export function tradeQueryKey(request: TradeRequest): string {
  const params = tradeQueryParams(request);
  return [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

const join = (values: readonly string[]) => [...values].sort().join(",");
