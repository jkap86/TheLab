import { booleanFlag, integer, list } from "../query/parse.ts";

/**
 * `/api/trades`'s query string, validated into the shape the SQL is built from.
 *
 * The SQL beside it should only ever see checked values, and a pure parser is
 * one a test can call without a database behind it. It imports the shared
 * primitives relatively with a `.ts` extension — the mechanism the test runner
 * needs, and the reason this module drags no `pg` in.
 *
 * It reads parameters and never a request: how those parameters arrived — a
 * query string, or a query string with the league scope in a POST body — is
 * `./transport`'s, and the whole point of that split is that this module cannot
 * tell. The vocabulary is the client's `TradeFilters` and `LeagueFilters`
 * resolved into ids and instants, so the two ends stay a matched pair. Two
 * fields are worth reading twice:
 *
 * - **The date window arrives as epoch milliseconds, already resolved.** A
 *   trade carries an instant, and the day a reader means by "before today" is
 *   the day where *they* are — so the client resolves its own window and sends
 *   instants, which is also what keeps this parser from having a timezone in
 *   it.
 * - **The league filter arrives as a list of ids, not as rules.** The rules are
 *   the slot-group and scoring-key engine in `features/shared/league-filters`,
 *   and re-implementing it in SQL is the kind of second copy that drifts
 *   silently. The client already holds every league of the season (it needs
 *   them to draw the filter dialog's own counts), so it evaluates the rules
 *   there and sends the answer. See {@link TradeQuery.leagues}.
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
 * it", and the question readers actually arrive with is "what did *he* give
 * *her*".
 *
 * **Everything in it is what that side received**, which is where the direction
 * comes from — there is no `gave` field anywhere in this vocabulary. What a
 * side gave up is what the *other* side received, so a reader asking "what did
 * this manager give up" names them on one side and puts the player on the
 * other. That is the same rule `assembleTrade` follows for storage, applied to
 * the question instead of to the answer.
 *
 * A side with nothing in it narrows nothing at all — see
 * {@link parseTradeQuery}.
 */
export type TradeSideQuery = {
  /** The user id whose side this is, or null for "anyone". */
  manager: string | null;
  /** Player ids that side received. */
  players: string[];
  /** `season-round` pick tokens that side received. */
  picks: string[];
  /**
   * Whether the assets above are *all* that side received — no other player, no
   * other pick, no FAAB.
   *
   * **A claim about one side, which is why it is a field here and not a third
   * {@link TradeMatchMode}.** `all` and `any` say how the assets a bay names
   * combine; this says what the bay leaves out, and a reader wanting "he gave
   * up only this player, for whatever he could get" is making that claim about
   * exactly one of the two bays.
   *
   * Stated as *nothing outside the named set*, never as a count: that reading
   * composes with `any` for free ("received one of these and nothing else"),
   * and it lets a trade carrying two 2027 firsts satisfy `2027-1`, since a
   * token names a season and a round rather than a specific pick.
   *
   * **False on a side that names no assets**, whatever the query string said —
   * "this manager received nothing" is a different question wearing the same
   * key, and a flag that cannot change an answer is a cache key split for
   * nothing. See {@link parseTradeQuery}.
   */
  only: boolean;
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
 * **One selection rather than three checkboxes, because they nest.** Every
 * trade in a reader's own league was made by people they play against, and
 * everyone they play against is in a league they are in; so
 * `mine ⊆ leaguemates ⊆ leaguemate-leagues`, and offering them as independent
 * boxes would be offering unions that are always just the widest one ticked.
 * What varies is only how far out the circle is drawn.
 *
 * - `all` — every stored league. The default, and the page's premise: the
 *   leagues a reader plays in are a fraction of the trades worth reading.
 * - `mine` — leagues the account fielded a team in, which is
 *   `getManagerLeagueIds` and therefore the same list the manager tool shows.
 * - `leaguemates` — trades a leaguemate was **party to**, in any league at all.
 *   This is the one that is not a league scope: what it asks about is who was
 *   dealing, which is why it reads through `trade_participants` the way the
 *   managers filter does.
 * - `leaguemate-leagues` — trades in any league a leaguemate **belongs to**,
 *   whoever made them. The widest of the three, and the one that answers "what
 *   does the market I'm adjacent to look like".
 *
 * The account itself counts as one of its own leaguemates — see
 * `getLeaguemateIds`, where the reason the nesting above holds is spelled out.
 */
export type TradeCircle = "all" | "mine" | "leaguemates" | "leaguemate-leagues";

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
   * `features/trades/league-scope`), and **either can outrun a request line**:
   * the shorter list is bounded by half the corpus, and the corpus is what the
   * crawler grows. So the ids arrive on the line or in a POST body, whichever
   * fits — `shared/trades/transport` folds the two into one `URLSearchParams`
   * before this parser sees either, which is why nothing below knows the
   * difference. What must never come back is the older reading of that
   * threshold, where the page gave up narrowing past it and filtered in the
   * browser: a first page whose trades all came from excluded leagues renders
   * as an empty board, which unmounts the list, which is what would have asked
   * for page two.
   */
  leagues: string[] | null;
  /** League ids to exclude — the complement form of the above. */
  excludeLeagues: string[] | null;
  /**
   * The account the circle below is drawn around, or null where the caller has
   * none. Sent as an id rather than resolved from a session because this app
   * has no session: the tools page resolves a username to a `UserInfo` and the
   * pages read it back out of the browser's own storage.
   */
  user: string | null;
  /**
   * How close to {@link user} a trade has to be. Always `"all"` when there is
   * no user — see {@link parseTradeQuery}: a circle with nobody at the centre
   * of it has no honest reading, and the neutral form of a narrowing is not
   * narrowing.
   *
   * Unlike the league ids beside it, this crosses the wire **unresolved**: the
   * sets it stands for are a manager's leagues and their leaguemates, which are
   * the database's answer and not the browser's — a client that had them in
   * hand to send would have had to be told them first. `resolveTradeCircle` is
   * what turns it into ids, once per reader per TTL rather than once per page.
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
  /** The opaque page token, passed through to `decodeTradeCursor`. */
  cursor: string | null;
};

/**
 * How many trades one page carries.
 *
 * **Smaller than TheLabX's 200, and the reason is the list underneath it.**
 * That board windows its rows through a virtualizer, so a page is bytes and
 * nothing more; this one renders every loaded card, so a page is also DOM that
 * never goes away. A hundred cards is several screens, which is past what a
 * flick covers, and it keeps ten pages of scrolling to a thousand nodes rather
 * than two.
 */
export const DEFAULT_TRADE_PAGE_SIZE = 100;

/**
 * The ceiling on `?limit`. Not a tuning knob so much as a bound on what one
 * request can cost: the enrichment behind a page is three id lookups whose size
 * scales with it, and the page is JSON-serialised in one go.
 */
export const MAX_TRADE_PAGE_SIZE = 200;

/**
 * Read a `/api/trades` query string.
 *
 * Everything is optional but the season, which the caller resolves before
 * getting here. Nothing here can fail the request: an unreadable value falls
 * back to its neutral form, because every field is a *narrowing* and the
 * neutral form of a narrowing is not narrowing. A 400 for a malformed `to=`
 * would turn a stale bookmark into an error page.
 *
 * (The season is the one exception, and it is the route's rather than this
 * module's: `parseRequestedSeason` answers an explicitly bad `?season=` with a
 * 400, which is the house rule everywhere in this app.)
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
    leagues: ids(params, "leagues"),
    excludeLeagues: ids(params, "xleagues"),
    user,
    circle,
    from: epoch(params, "from"),
    to: epoch(params, "to"),
    sides: sides(params),
    match: params.get("match") === "any" ? "any" : "all",
    limit:
      limit.ok && limit.value !== null ? limit.value : DEFAULT_TRADE_PAGE_SIZE,
    cursor: params.get("cursor"),
  };
}

/**
 * The sides, read off `s1manager` / `s1players` / `s1picks` / `s1only` and their
 * `s2…` siblings.
 *
 * **Indexed parameters rather than one encoded blob**, because the point of a
 * query string here is that it is the cache key and the shareable link: a
 * reader can see which side a player is on without a decoder, and an unreadable
 * value falls back to its neutral form the way every other field does.
 *
 * **Empty sides are dropped, and the index is kept only as an ordering.** A bay
 * a reader emptied is not a claim that some side received nothing — it is
 * "don't care" — so it must not reach the SQL as a constraint. Which also means
 * the numbering is not identity: `?s2players=…` alone is one side, the same
 * query as `?s1players=…`, and the client is free to leave either bay empty.
 */
function sides(params: URLSearchParams): TradeSideQuery[] {
  const out: TradeSideQuery[] = [];
  for (let index = 1; index <= MAX_TRADE_SIDES; index++) {
    const players = list(params, `s${index}players`);
    const picks = list(params, `s${index}picks`);
    // `booleanFlag` rather than `booleanFilter`: absent means *off* for a flag
    // like this one, where for a population filter it means "don't filter" —
    // the whole reason those are two named functions.
    const only = booleanFlag(params, `s${index}only`);
    const side = {
      manager: params.get(`s${index}manager`)?.trim() || null,
      players,
      picks,
      // A bay naming no asset has nothing for `only` to exclude *to*, so the
      // flag is dropped rather than carried: "this manager received nothing" is
      // a different question, and honouring it here would make one key mean two
      // things. See {@link TradeSideQuery.only}.
      only: (players.length > 0 || picks.length > 0) && only.ok && only.value,
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
 * missing parameter and `[]` for `?leagues=`, where {@link list} collapses
 * both.
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
 * The route reads it to decide whether the two denominators are the same
 * number, which is what keeps the unnarrowed board — the state the page opens
 * in — to one count rather than two.
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
 * looking at.
 *
 * **The circle stays**, with the league ids and against the window and the
 * selection. It is where a reader is standing rather than something they picked
 * off a list of trades — "8 of 340" over their leaguemates' leagues is the
 * denominator that means anything there, and counting it against every stored
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

/**
 * The query the **facet menus** are counted over: this one with the selection
 * lifted out, the league scope and the window left in.
 *
 * A menu counted over its own selection collapses to that selection the moment
 * you make one, and cannot be widened without being cleared first — so the
 * counts beside the options have to describe the population the selection is
 * being made *against*. In TheLabX this rule lived inside the facets memoiser,
 * which stripped `sides` as part of building its cache key; there is no
 * memoiser here, so it is a named function the route calls instead of a step
 * the route could forget.
 */
export function facetsQuery(query: TradeQuery): TradeQuery {
  return { ...query, sides: [] };
}
