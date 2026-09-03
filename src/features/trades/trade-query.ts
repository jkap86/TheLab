import type { TradeBounds, TradeFilters } from "./filters.ts";
import { type LeagueScope, resolveLeagueScope } from "./league-scope.ts";

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

/**
 * The league-scope vocabulary, re-exported so this feature's consumers keep one
 * import for "what the board is asking for".
 *
 * TheLabX also builds a `tradeHttpRequest` here — a method, a query string and
 * a body — because a scope past ~500 ids moves to a POST. There is no body form
 * in this port (see `./league-scope`), so a request is always a GET and its
 * query string is the whole of it.
 */
export { type LeagueScope, resolveLeagueScope };

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
 *
 */
export function tradeQueryParams(request: TradeRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set("season", request.season);

  const { scope } = request;
  if (scope.kind === "include") {
    params.set("leagues", join(scope.ids));
  } else if (scope.kind === "exclude") {
    params.set("xleagues", join(scope.ids));
  }

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
    // Guarded on the bay holding an asset for the reason `match` is guarded
    // below: the flag says "and nothing else *but these*", so with nothing named
    // it cannot change an answer — and the server drops it in that case anyway,
    // so sending it would split the cache between two identical boards.
    if (side.only && side.players.length + side.picks.length > 0) {
      params.set(`${prefix}only`, "1");
    }
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
 * A string rather than the object it came from, because it is the *subject*
 * the paging hook resets on: two structurally different objects describing the
 * same request would restart a board that had not changed, and the string
 * compares by value for free.
 */
export function tradeQueryKey(request: TradeRequest): string {
  const params = tradeQueryParams(request);
  return [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

const sorted = (values: readonly string[]) => [...values].sort();
const join = (values: readonly string[]) => sorted(values).join(",");
