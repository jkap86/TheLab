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

/**
 * One side of the trade a reader is describing: whose it is, and what it
 * received.
 *
 * **A side is a roster, so `manager` is one name and never a list.** Two people
 * cannot own one side of a trade, which is what makes this shape honest where a
 * flat `managers[]` was not: that list could only ever ask "was this person in
 * it", and the question readers actually arrive with is "what did *he* give *her*".
 *
 * **Everything in it is what that side received**, which is where the direction
 * comes from — there is no `gave` field anywhere in this vocabulary. What a side
 * gave up is what the *other* side received, so a reader asking "what did jkap
 * give up" names jkap on one side and puts the player on the other. That is the
 * same rule `assembleTrade` follows for storage (a side holds only its takes,
 * because holding both halves is one edit away from them disagreeing), applied
 * to the question instead of to the answer.
 *
 * A side with nothing in it narrows nothing at all — see {@link parseTradeQuery}.
 */
export type TradeSideQuery = {
  /** The user id whose side this is, or null for "anyone". */
  manager: string | null;
  /** Player ids that side received. */
  players: string[];
  /** `season-round` pick tokens that side received. */
  picks: string[];
};

/**
 * How many sides a query will read.
 *
 * Two is the control's shape and three is a real trade — the board carries
 * three-way trades and the card draws them — so the *vocabulary* is a list and
 * only the UI is a pair. The cap exists because the parameters are indexed and
 * an unbounded loop over a hostile query string is a way to make this route
 * build arbitrarily large SQL.
 */
export const MAX_TRADE_SIDES = 4;

/**
 * How close to the reader a trade has to be — the board's population, read as a
 * distance from one account rather than as a property of a league.
 *
 * **One selection rather than three checkboxes, because they nest.** Every trade
 * in a reader's own league was made by people they play against, and everyone
 * they play against is in a league they are in; so
 * `mine ⊆ leaguemates ⊆ leaguemate-leagues`, and offering them as independent
 * boxes would be offering unions that are always just the widest one ticked.
 * What varies is only how far out the circle is drawn.
 *
 * - `all` — every crawled league. The default, and the page's whole premise: the
 *   leagues a reader plays in are a fraction of the trades worth reading.
 * - `mine` — leagues the account fielded a team in, which is
 *   `getManagerLeagueIds` and therefore the same list the manager tool shows.
 * - `leaguemates` — trades a leaguemate was **party to**, in any league at all.
 *   This is the one that is not a league scope: what it asks about is who was
 *   dealing, which is why it reads through `rosters` the way the managers filter
 *   does.
 * - `leaguemate-leagues` — trades in any league a leaguemate **belongs to**,
 *   whoever made them. The widest of the three, and the one that answers "what
 *   does the market I'm adjacent to look like".
 *
 * The account itself counts as one of its own leaguemates — see
 * `getLeaguemateIds`, where the reason the nesting above holds is spelled out.
 */
export type TradeCircle =
  | "all"
  | "mine"
  | "leaguemates"
  | "leaguemate-leagues";

const TRADE_CIRCLES: readonly TradeCircle[] = [
  "all",
  "mine",
  "leaguemates",
  "leaguemate-leagues",
];

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
  /**
   * The account the circle below is drawn around, or null where the caller has
   * none. Sent as an id rather than resolved from a session because this app has
   * no session: the tools page resolves a username to a `UserInfo` and the pages
   * read it back out of the browser's own storage.
   */
  user: string | null;
  /**
   * How close to {@link user} a trade has to be. Always `"all"` when there is no
   * user — see {@link parseTradeQuery}: a circle with nobody at the centre of it
   * has no honest reading, and the neutral form of a narrowing is not narrowing.
   *
   * Unlike the league ids beside it, this crosses the wire **unresolved**: the
   * sets it stands for are a manager's leagues and their leaguemates, which are
   * the database's answer and not the browser's — a client that had them in hand
   * to send would have had to be told them first. `resolveTradeCircle` is what
   * turns it into ids, once per reader per TTL rather than once per page.
   */
  circle: TradeCircle;
  /** Inclusive lower bound on `completed_at`, epoch ms; null for an open end. */
  from: number | null;
  /** Exclusive upper bound on `completed_at`, epoch ms; null for an open end. */
  to: number | null;
  /**
   * The sides the reader described, in the order they were sent — see
   * {@link TradeSideQuery}. Empty sides are dropped by the parser, so a side
   * present here always narrows something.
   *
   * **Two sides mean "on opposite sides", never "this trade had exactly two".**
   * A three-way where a third roster took something still matches, which is the
   * reading the card already takes and the only one that doesn't silently hide
   * trades.
   */
  sides: TradeSideQuery[];
  /**
   * Whether a side has to have received *all* of its assets or any one of them.
   *
   * It applies **within** a side and has nothing left to say across them: which
   * side each asset went to is the whole of what the sides express, so an `any`
   * spanning them would be asking for a trade to satisfy one of two structural
   * claims — a question nobody has.
   */
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
 * How many league ids the client will put in a query string before sending them
 * in a POST body instead.
 *
 * At ~19 characters an id plus a separator, 500 ids is ~10KB — past what several
 * proxies and CDNs accept on a request line, and the failure mode is a 414 that
 * looks like the page being broken. Past this the same ids arrive as JSON and
 * this parser reads them from there; the narrowing is the database's either way.
 *
 * It used to be the point at which the request went *unnarrowed* and the browser
 * filtered what came back, which is the false-empty bug that path is gone for —
 * see `features/trades/trade-query`.
 */
export const MAX_LEAGUE_IDS = 500;

/**
 * The ceiling on how many league ids one body may carry.
 *
 * Not a tuning knob: it is the bound on how large a `= ANY($n)` this route will
 * build out of something a caller sent. The client only ever sends the *shorter*
 * of the include and exclude lists, so reaching this at all means a corpus of
 * 100k leagues in one season — far past anything real, and the honest failure
 * there is a truncated narrowing rather than an unbounded query.
 */
export const MAX_BODY_LEAGUE_IDS = 50_000;

/**
 * What a league id may look like before it is bound into a query.
 *
 * Sleeper's are digit strings; this is deliberately a little wider so a future
 * id shape doesn't silently empty a board, and deliberately bounded so a body
 * cannot carry megabyte-long "ids". Everything still arrives as a bound
 * parameter — this is about the *size* of what one request can ask for, not
 * about escaping.
 */
const LEAGUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The league scope as a request body carries it, before validation. */
export type TradeScopeBody = {
  leagues: string[] | null;
  excludeLeagues: string[] | null;
};

/** Nothing narrowed — what an absent or unreadable body means. */
export const NO_SCOPE_BODY: TradeScopeBody = {
  leagues: null,
  excludeLeagues: null,
};

/**
 * Read the league scope out of a POST body.
 *
 * Lenient in exactly the way the query-string parser is: an unreadable value is
 * *absent* rather than an error, because every field here is a narrowing and the
 * neutral form of a narrowing is not narrowing. The one distinction it must keep
 * is the same one `ids` keeps — an empty array is "the rules matched nothing",
 * which is a real answer and an empty board, where a missing key is "not
 * narrowing this way".
 */
export function parseTradeScopeBody(body: unknown): TradeScopeBody {
  if (typeof body !== "object" || body === null) return NO_SCOPE_BODY;
  const record = body as Record<string, unknown>;
  return {
    leagues: bodyIds(record.leagues),
    excludeLeagues: bodyIds(record.xleagues),
  };
}

/** One body id list: deduplicated, shape-checked and capped. */
function bodyIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !LEAGUE_ID_PATTERN.test(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= MAX_BODY_LEAGUE_IDS) break;
  }
  return out;
}

/**
 * Read a `/api/trades` query string.
 *
 * Everything is optional but the season, which the caller resolves before
 * getting here (an absent one is the active season, not a 400 — the same rule
 * the route has always followed). Nothing here can fail the request: an
 * unreadable value falls back to its neutral form, because every field is a
 * *narrowing* and the neutral form of a narrowing is not narrowing. A 400 for a
 * malformed `to=` would turn a stale bookmark into an error page.
 *
 * `scope` is the league ids read off a POST body, where they were too long for
 * the query string (see {@link MAX_LEAGUE_IDS}). A body list *overrides* the
 * query-string one rather than merging with it: they are two spellings of one
 * narrowing, and the client sends exactly one of them. Everything downstream —
 * the SQL, the cursor, the counts, the facets — sees one {@link TradeQuery} and
 * cannot tell which arrived, which is the whole point of taking it here.
 */
export function parseTradeQuery(
  params: URLSearchParams,
  season: string,
  scope: TradeScopeBody = NO_SCOPE_BODY,
): TradeQuery {
  const limit = integer(params, "limit", {
    min: 1,
    max: MAX_TRADE_PAGE_SIZE,
    fallback: DEFAULT_TRADE_PAGE_SIZE,
  });

  // A blank `?user=` is no user, not a manager whose id is the empty string —
  // and with no user the circle is forced open, so a client that sends one
  // without the other gets the unnarrowed board rather than an empty one.
  const user = params.get("user")?.trim() || null;
  const requested = params.get("circle");
  const circle =
    user !== null && TRADE_CIRCLES.includes(requested as TradeCircle)
      ? (requested as TradeCircle)
      : "all";

  return {
    season,
    leagues: scope.leagues ?? ids(params, "leagues"),
    excludeLeagues: scope.excludeLeagues ?? ids(params, "xleagues"),
    user,
    circle,
    from: epoch(params, "from"),
    to: epoch(params, "to"),
    sides: sides(params),
    match: params.get("match") === "any" ? "any" : "all",
    limit: limit.ok && limit.value !== null ? limit.value : DEFAULT_TRADE_PAGE_SIZE,
    cursor: params.get("cursor"),
  };
}

/**
 * The sides, read off `s1manager` / `s1players` / `s1picks` and their `s2…`
 * siblings.
 *
 * **Indexed parameters rather than one encoded blob**, because the whole point of
 * a query string here is that it is the cache key and the shareable link: a
 * reader can see which side a player is on without a decoder, and an unreadable
 * value falls back to its neutral form the way every other field does.
 *
 * **Empty sides are dropped, and the index is kept only as an ordering.** A bay a
 * reader emptied is not a claim that some side received nothing — it is "don't
 * care" — so it must not reach the SQL as a constraint. Which also means the
 * numbering is not identity: `?s2players=…` alone is one side, the same query as
 * `?s1players=…`, and the client is free to leave either bay empty.
 */
function sides(params: URLSearchParams): TradeSideQuery[] {
  const out: TradeSideQuery[] = [];
  for (let index = 1; index <= MAX_TRADE_SIDES; index++) {
    const side = {
      manager: params.get(`s${index}manager`)?.trim() || null,
      players: list(params, `s${index}players`),
      picks: list(params, `s${index}picks`),
    };
    if (side.manager !== null || side.players.length || side.picks.length) {
      out.push(side);
    }
  }
  return out;
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
    query.circle === "all" &&
    query.leagues === null &&
    query.excludeLeagues === null &&
    query.from === null &&
    query.to === null &&
    query.sides.length === 0
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
 *
 * **The circle stays**, with the league ids and against the window and the
 * selection. It is where a reader is standing rather than something they picked
 * off a list of trades — "8 of 340" over their leaguemates' leagues is the
 * denominator that means anything there, and counting it against every crawled
 * league would state a fraction of a board they never asked to see.
 */
export function leagueScopeQuery(query: TradeQuery): TradeQuery {
  return { ...query, from: null, to: null, sides: [] };
}

/**
 * Whether anything beyond the league filters is narrowing — the window or the
 * selection. False means {@link leagueScopeQuery}'s count is the same number as
 * the query's own, so only one of the two is run.
 */
export function hasTradeNarrowing(query: TradeQuery): boolean {
  return query.from !== null || query.to !== null || query.sides.length > 0;
}
