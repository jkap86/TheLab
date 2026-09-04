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
 * How a request *travels* is {@link tradeHttpRequest}'s: a scope too long for a
 * request line moves into a body, which is TheLabX's arrangement and is now
 * this repo's too — see `./league-scope` for what made it earn its place here.
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

/**
 * The most query string one trades request may put on its request line, in
 * characters.
 *
 * **A budget for the whole header block, not for the URL.** A router's limit —
 * Heroku's is 8KB — covers the request line *and* every header beside it, so
 * what this leaves is ~6KB for cookies, the user agent and the rest. Two
 * thousand characters is around ninety league ids, since a nineteen-digit
 * Sleeper id and its encoded separator cost twenty-two each.
 *
 * It is deliberately far below the limit rather than just under it: what sits
 * on the other side is not a slower board but a **431 with an empty body**,
 * which reaches the page as a failed fetch naming nothing at all. Being wrong
 * in the safe direction costs a POST.
 */
export const MAX_TRADE_QUERY_CHARS = 2000;

/**
 * The parameters that may move off the request line.
 *
 * **Only the league scope, because only the league scope is unbounded.** Every
 * other parameter here is something a reader picked — a manager, a handful of
 * players, two picks — and a person cannot select their way past a request
 * line. The scope is the *answer* to the league rules, computed over the whole
 * corpus (see `./league-scope`), so it grows with the crawler rather than with
 * anything anyone typed.
 */
const MOVABLE_KEYS = ["leagues", "xleagues"] as const;

/** One trades read as it goes on the wire. `body` is null for a plain GET. */
export type TradeHttpRequest = {
  method: "GET" | "POST";
  /** What stays on the request line. */
  search: URLSearchParams;
  /** The rest, form-encoded, or null where everything fitted. */
  body: string | null;
};

/**
 * How to send a set of trade parameters: as a query string, or — where that
 * string is longer than a router will carry — as a query string with the league
 * scope moved into a body.
 *
 * **The body is the rest of the query string, not a vocabulary of its own.** It
 * is form-encoded and the route folds it back into one `URLSearchParams` before
 * anything reads it (`shared/trades/transport`), so a parameter is spelled once
 * and parsed once however it travelled.
 *
 * **Nothing about identity moves with it.** {@link tradeQueryKey} is built from
 * the parameters and never from this, because what a request *is* cannot depend
 * on how it fitted: the same board reached by a GET and by a POST is one cache
 * entry and one subject.
 *
 * Two costs, both taken deliberately. A POST response is not held by the
 * browser's cache, so a narrowed board forfeits the page route's
 * `private, max-age=30` and with it the back button's free redraw. And a
 * request that is over the budget with **nothing movable in it** stays a GET
 * rather than being refused here: the parameters left are a reader's own
 * selections, so the honest failure is the router's rather than a board this
 * module quietly declined to ask for.
 */
export function tradeHttpRequest(params: URLSearchParams): TradeHttpRequest {
  const line: TradeHttpRequest = { method: "GET", search: params, body: null };
  if (params.toString().length <= MAX_TRADE_QUERY_CHARS) return line;

  const search = new URLSearchParams(params);
  const body = new URLSearchParams();
  let moved = false;
  for (const key of MOVABLE_KEYS) {
    for (const value of search.getAll(key)) {
      body.append(key, value);
      moved = true;
    }
    search.delete(key);
  }

  return moved ? { method: "POST", search, body: body.toString() } : line;
}

const sorted = (values: readonly string[]) => [...values].sort();
const join = (values: readonly string[]) => sorted(values).join(",");
