import {
  MAX_LEAGUE_IDS,
  type LeagueScope,
  type LeagueScopeBody,
  resolveLeagueScope,
  scopeNeedsBody,
} from "../shared/league-scope.ts";

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

/**
 * The league-scope vocabulary, re-exported from where it now lives.
 *
 * It was written here and moved to `features/shared/league-scope` when the ADP
 * board became its second reader — the mover's usual rule, so this page's own
 * consumers keep one import and there is one definition of what a scope is. See
 * that module for why the rules are resolved in the browser at all, and why the
 * long ones travel in a body.
 */
export {
  MAX_LEAGUE_IDS,
  type LeagueScope,
  resolveLeagueScope,
  scopeNeedsBody,
};

/** The league ids a large scope sends as JSON, under this route's own name. */
export type TradeScopeBody = LeagueScopeBody;

/**
 * One HTTP request for a trades read: the method, the query string and the body.
 *
 * **GET and POST differ in where the league ids ride and in nothing else.** The
 * season, the circle, the window, the bays and the pagination parameters are on
 * the query string either way, so the route parses one query and the keyset walk
 * is identical — which is what keeps a large scope from being a second code path
 * with its own bugs. `cursor` and `limit` stay out of {@link tradeQueryKey} for
 * the same reason they always did: they are pagination rather than narrowing.
 */
export type TradeHttpRequest = {
  method: "GET" | "POST";
  search: URLSearchParams;
  body: TradeScopeBody | null;
};

export function tradeHttpRequest(
  request: TradeRequest,
  page: { cursor?: string | null; limit?: number } = {},
): TradeHttpRequest {
  const large = scopeNeedsBody(request.scope);
  const search = tradeQueryParams(request, { inlineScope: !large });
  if (page.cursor) search.set("cursor", page.cursor);
  if (page.limit) search.set("limit", String(page.limit));

  if (!large || request.scope.kind === "all") {
    return { method: "GET", search, body: null };
  }
  return {
    method: "POST",
    search,
    body:
      request.scope.kind === "include"
        ? { leagues: sorted(request.scope.ids) }
        : { xleagues: sorted(request.scope.ids) },
  };
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
 *
 * `inlineScope` is false only where the ids are about to travel in a body, and
 * only for the *wire* — the cache key always inlines them, because two league
 * sets that differ are two boards whatever transport carries them.
 */
export function tradeQueryParams(
  request: TradeRequest,
  options: { inlineScope?: boolean } = {},
): URLSearchParams {
  const { inlineScope = true } = options;
  const params = new URLSearchParams();
  params.set("season", request.season);

  const { scope } = request;
  if (inlineScope && scope.kind === "include") {
    params.set("leagues", join(scope.ids));
  } else if (inlineScope && scope.kind === "exclude") {
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

const sorted = (values: readonly string[]) => [...values].sort();
const join = (values: readonly string[]) => sorted(values).join(",");
