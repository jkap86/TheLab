import { integer, list } from "../query/parse.ts";

/**
 * `/api/trades`'s query string, validated into the shape the SQL is built from.
 *
 * The same job `shared/manager/adp-filters` does for the ADP board, and it is
 * here for the same reason: the SQL beside it should only ever see checked
 * values, and a pure parser is one a test can call without a database behind it.
 * It imports the shared primitives relatively with a `.ts` extension — the
 * mechanism the test runner needs, and the reason this module drags no `pg` in.
 *
 * **This is the half of the trades work that made the page stop downloading a
 * season.** Every filter the page offers used to be applied in the browser over
 * the whole of it, so the route took nothing but a season; the browser now sends
 * what it is asking for and gets back a page of answers. What each field means
 * is unchanged — the vocabulary is the client's `TradeFilters` and
 * `LeagueFilters` resolved into ids and instants, so the two ends stay a matched
 * pair the way `/api/adp` and `adp-controls` are.
 *
 * Two of them are worth reading twice:
 *
 * - **The date window arrives as epoch milliseconds, already resolved.** The ADP
 *   board takes bare `YYYY-MM-DD` dates and converts them in SQL, because what a
 *   bare date means is a zone question and only the database knows the zone to
 *   read it in. Here the opposite holds: a trade carries an instant, and the day
 *   a reader means by "last 7 days" is the day where *they* are — the `todayIso`
 *   side of the two-todays rule. So the client resolves its own window and sends
 *   instants, which is also what keeps this parser from having a timezone in it.
 * - **The league filter arrives as a list of ids, not as rules.** The rules are
 *   a slot-group and scoring-key engine over Sleeper's JSONB blobs, and
 *   re-implementing it in SQL is the kind of second copy that drifts silently.
 *   The client already holds every league of the season (it needs them to draw
 *   the filter dialog's own counts), so it evaluates the rules there and sends
 *   the answer. See {@link TradeQuery.leagues}.
 */

/** The selection modes a trade filter set can be read under. */
export type TradeMatchMode = "all" | "any";

/** A validated `/api/trades` request. */
export type TradeQuery = {
  season: string;
  /**
   * League ids to restrict to, or null for "every league in the season".
   *
   * Null is not the same as an empty array: empty means the reader's league
   * rules matched nothing and the honest answer is no trades, where null means
   * they are not narrowing at all.
   *
   * The client sends whichever of the include and exclude lists is shorter (see
   * `features/trades/trade-query`), and sends neither when both would be longer
   * than {@link MAX_LEAGUE_IDS} — a query string is not a place to put ten
   * thousand characters. In that case the page falls back to filtering the ids
   * itself as pages arrive, which is what its pending bucket is for.
   */
  leagues: string[] | null;
  /** League ids to exclude — the complement form of the above. */
  excludeLeagues: string[] | null;
  /** Inclusive lower bound on `completed_at`, epoch ms; null for an open end. */
  from: number | null;
  /** Exclusive upper bound on `completed_at`, epoch ms; null for an open end. */
  to: number | null;
  players: string[];
  /** `season-round` tokens, e.g. `"2026-1"`. */
  picks: string[];
  /** User ids party to the trade. */
  managers: string[];
  match: TradeMatchMode;
  limit: number;
  /** The opaque page token, passed through to {@link decodeTradeCursor}. */
  cursor: string | null;
};

/**
 * How many trades one page carries.
 *
 * A page is what the reader waits for on first paint and what the scroll
 * prefetch buys ahead, so it wants to be small enough that the first one is
 * instant and large enough that a fast scroll doesn't outrun the prefetch. Two
 * hundred cards is roughly ten screens on a laptop, which is well past what a
 * flick covers, and ~80KB of JSON before compression — against the ~20MB the
 * page used to download before it could show anything.
 */
export const DEFAULT_TRADE_PAGE_SIZE = 200;

/**
 * The ceiling on `?limit`. Not a tuning knob so much as a bound on what one
 * request can cost: the enrichment behind a page is four id lookups whose size
 * scales with it, and the page is JSON-serialised in one go.
 */
export const MAX_TRADE_PAGE_SIZE = 500;

/**
 * How many league ids the client will put in a query string before giving up and
 * sending none.
 *
 * At ~19 characters an id plus a separator, 500 ids is ~10KB — past what several
 * proxies and CDNs accept on a request line, and the failure mode is a 414 that
 * looks like the page being broken. Past this the request goes unnarrowed and
 * the client's own residual pass does the narrowing, which costs a set lookup
 * per trade and some over-fetching, and is the same answer.
 */
export const MAX_LEAGUE_IDS = 500;

/**
 * Read a `/api/trades` query string.
 *
 * Everything is optional but the season, which the caller resolves before
 * getting here (an absent one is the active season, not a 400 — the same rule
 * the route has always followed). Nothing here can fail the request: an
 * unreadable value falls back to its neutral form, because every field is a
 * *narrowing* and the neutral form of a narrowing is not narrowing. A 400 for a
 * malformed `to=` would turn a stale bookmark into an error page.
 */
export function parseTradeQuery(
  params: URLSearchParams,
  season: string,
): TradeQuery {
  const limit = integer(params, "limit", {
    min: 1,
    max: MAX_TRADE_PAGE_SIZE,
    fallback: DEFAULT_TRADE_PAGE_SIZE,
  });

  return {
    season,
    leagues: ids(params, "leagues"),
    excludeLeagues: ids(params, "xleagues"),
    from: epoch(params, "from"),
    to: epoch(params, "to"),
    players: list(params, "players"),
    picks: list(params, "picks"),
    managers: list(params, "managers"),
    match: params.get("match") === "any" ? "any" : "all",
    limit: limit.ok && limit.value !== null ? limit.value : DEFAULT_TRADE_PAGE_SIZE,
    cursor: params.get("cursor"),
  };
}

/**
 * A comma-separated id list, or null where the parameter is absent.
 *
 * The absent/empty distinction is load-bearing here in a way it is not for
 * `players` — see {@link TradeQuery.leagues} — so this returns null for a
 * missing parameter and `[]` for `?leagues=`, where {@link list} collapses both.
 */
function ids(params: URLSearchParams, key: string): string[] | null {
  const raw = params.get(key);
  if (raw === null) return null;
  return list(params, key);
}

/** An epoch-millisecond bound; null for absent, malformed or negative. */
function epoch(params: URLSearchParams, key: string): number | null {
  const parsed = integer(params, key, { min: 0, fallback: null });
  return parsed.ok ? parsed.value : null;
}

/**
 * Whether a query narrows the board at all beyond the season.
 *
 * The route reads it to decide where the total comes from: unnarrowed, it is the
 * precomputed `trade_market_stats` row; narrowed, it has to be counted, which is
 * why that count runs only on a first page.
 */
export function isUnnarrowed(query: TradeQuery): boolean {
  return (
    query.leagues === null &&
    query.excludeLeagues === null &&
    query.from === null &&
    query.to === null &&
    query.players.length === 0 &&
    query.picks.length === 0 &&
    query.managers.length === 0
  );
}

/**
 * The same query narrowed by the **league filters alone** — the window and the
 * player/pick/manager selection lifted out.
 *
 * This is the population the page's headline reads "N of M trades" against, and
 * the `M` has to be exactly that: the league filters say which leagues' trades
 * are on the board at all, and the trade filters say which of *those* are worth
 * looking at. The distinction was free when the browser held the season and both
 * passes ran over it; server-side it is a second count, which is why
 * {@link hasTradeNarrowing} exists to skip it when the two numbers are equal.
 */
export function leagueScopeQuery(query: TradeQuery): TradeQuery {
  return { ...query, from: null, to: null, players: [], picks: [], managers: [] };
}

/**
 * Whether anything beyond the league filters is narrowing — the window or the
 * selection. False means {@link leagueScopeQuery}'s count is the same number as
 * the query's own, so only one of the two is run.
 */
export function hasTradeNarrowing(query: TradeQuery): boolean {
  return (
    query.from !== null ||
    query.to !== null ||
    query.players.length > 0 ||
    query.picks.length > 0 ||
    query.managers.length > 0
  );
}
