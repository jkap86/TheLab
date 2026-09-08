import { getLeaguemateIds, getManagerLeagueIds } from "@/shared/manager";

import { BoundedCache } from "./cache";
import type { TradeCircle, TradeQuery } from "./params";

/**
 * Turning a reader's {@link TradeCircle} into the ids the board's `WHERE` is
 * built from.
 *
 * **This is the one filter the client cannot resolve for itself, which is why
 * it crosses the wire as a word rather than as a list.** The league rules go
 * the other way — the browser already holds every league of the season for the
 * filter dialog's counts, so it evaluates the rules and sends the answer. A
 * circle's answer is *which leagues a manager fielded a team in* and *who
 * shares one with them*, and a browser holding that would have had to be told
 * it first. So the account id and the circle are what travel, and this resolves
 * them.
 *
 * Three shapes come out, and the third is the one worth noticing: two of the
 * circles narrow *leagues* and one narrows *who was dealing*, which is why this
 * cannot simply hand back a league list. See {@link TradeCircleScope}.
 */

/**
 * A resolved circle — what `tradeFilterSql` binds.
 *
 * Ids rather than a correlated subquery over `league_users` per row: the sets
 * are small (a manager plays in a hundred-odd leagues and knows a few thousand
 * people), and binding them keeps the board's `ORDER BY` over `transactions`
 * alone — the same reason the population is written as `EXISTS` filters rather
 * than as joins.
 */
export type TradeCircleScope =
  /** Trades in these leagues, by anyone. */
  | { kind: "leagues"; ids: string[] }
  /** Trades in any league one of these users belongs to, by anyone. */
  | { kind: "members"; ids: string[] }
  /** Trades one of these users was party to, in any league. */
  | { kind: "traders"; ids: string[] };

/**
 * How long a resolved circle is reused.
 *
 * It is a fact about league membership, which moves at the manager sync's pace
 * and, for a season already under way, barely moves at all. Ten minutes is the
 * same reading the roster-owner cache takes of the same tables: a leaguemate
 * added in the meantime costs a reader their trades for a few minutes rather
 * than being an answer that is wrong.
 */
const CIRCLE_TTL_MS = 10 * 60 * 1000;

/**
 * Keyed by `user:season:circle` — one entry per reader per circle they use.
 *
 * **Two bounds, because a thousand of these is not one size.** The count is
 * what it always was: a thousand entries is a thousand people using the page
 * inside one TTL, and the eviction order is recency, so the rest lose an entry
 * they were about to stop using anyway. What the count could not say is how
 * *big* those entries are — a circle is a hundred league ids for one reader and
 * several thousand leaguemate ids for another, so a thousand of the second kind
 * is a couple of million strings held for ten minutes on the strength of a
 * bound that reads "1000".
 *
 * So the weight is the ids themselves, which is exactly what the value is, and
 * `MAX_CIRCLE_IDS` is a real ceiling on what this can retain. A single circle
 * past it is not held at all — see {@link BoundedCache} — which costs that one
 * reader a re-derivation per request rather than costing the box its heap.
 */
const MAX_CIRCLE_IDS = 250_000;

const circleCache = new BoundedCache<string[]>(1000, CIRCLE_TTL_MS, {
  maxWeight: MAX_CIRCLE_IDS,
  weigh: (ids) => ids.length,
});

/**
 * The ids behind `query.circle`, or null where it is not narrowing.
 *
 * **Cached because a scroll is many requests.** Each page of the board, each
 * count and each facets read would otherwise re-derive the same two answers for
 * the same reader; held here, a reader resolves their circle once per TTL and
 * every page after that is the ids alone.
 *
 * An empty result is *not* folded back to "not narrowing" — an account this
 * database has never synced has no leagues and no leaguemates, and the honest
 * board for that is empty rather than every trade it has ever stored. The page
 * says as much in its own empty state, which is where a reader can act on it.
 */
export async function resolveTradeCircle(
  query: TradeQuery,
): Promise<TradeCircleScope | null> {
  const { user, circle, season } = query;
  if (user === null || circle === "all") return null;

  const ids = await cachedIds(user, season, circle);
  return { kind: SCOPE_KIND[circle], ids };
}

/** Which of the three shapes each circle resolves to. */
const SCOPE_KIND: Record<
  Exclude<TradeCircle, "all">,
  TradeCircleScope["kind"]
> = {
  mine: "leagues",
  leaguemates: "traders",
  "leaguemate-leagues": "members",
};

async function cachedIds(
  user: string,
  season: string,
  circle: Exclude<TradeCircle, "all">,
): Promise<string[]> {
  // Keyed by the circle as well as by the reader, because the three answers
  // below differ and a reader uses one of them at a time — there is nothing to
  // gain by resolving all three and plenty to lose in a season where a manager
  // has a hundred leagues.
  const key = `${user}:${season}:${circle}`;
  const hit = circleCache.get(key);
  if (hit) return hit;

  const ids = await resolveIds(user, season, circle);
  circleCache.set(key, ids);
  return ids;
}

/**
 * **The reader counts as their own leaguemate for one of the two leaguemate
 * circles and not for the other, and the asymmetry is the point.**
 *
 * `leaguemates` asks who was *dealing*, and the reader is the manager they are
 * certain to care about — including them is also what makes "my leagues" a
 * subset by construction rather than by an argument about counterparties, which
 * fails on the real case of a three-way trade where the other rosters are
 * orphans and carry no owner at all.
 *
 * `leaguemate-leagues` asks where a league *is*, and there the reader's own
 * membership is the wrong evidence: Sleeper leaves a `league_users` row behind
 * when someone stops holding a team, so counting it would pull leagues into the
 * widest circle that `mine` deliberately drops — a league showing up as a
 * leaguemate's and not as the reader's own, which reads as a bug because it is
 * one. Their real leagues arrive anyway, through the leaguemates who are still
 * in them; the only league that could be lost is one where the reader is the
 * sole member, which has nobody to trade with.
 */
async function resolveIds(
  user: string,
  season: string,
  circle: Exclude<TradeCircle, "all">,
): Promise<string[]> {
  if (circle === "mine") return getManagerLeagueIds(user, season);

  const mates = await getLeaguemateIds(user, season);
  return circle === "leaguemates" ? [user, ...mates] : mates;
}

/**
 * Forget the resolved circles of these readers, because a sync has just changed
 * what a circle of theirs resolves to.
 *
 * **Targeted, because a circle is per reader and a sync is per league.** The
 * key is `user:season:circle`, so "forget everything this league's members
 * knew" is a predicate over the first two segments; clearing the whole cache
 * would make every *other* reader on the box re-derive a hundred-league answer
 * to protect one league's members. `season` narrows further where the caller
 * knows it, and a null season forgets the reader's circles in every season —
 * which is what a caller that cannot name one should ask for.
 *
 * **First-order only, and that is a stated limit rather than an oversight.** A
 * league's membership changing also changes who the *leaguemates of its
 * members* are, and those readers are not in `users`. Chasing that is a second
 * query per sync to invalidate a cache; what it would buy is bounded by
 * {@link CIRCLE_TTL_MS}, which is the staleness this cache was always designed
 * to carry. What the targeted pass fixes is the case a reader can actually
 * observe: syncing your own leagues and then finding your own circle stale.
 */
export function forgetTradeCircles(
  users: readonly string[],
  season: string | null,
): number {
  if (users.length === 0) return 0;
  const readers = new Set(users);
  return circleCache.prune((key) => {
    // Split from the left twice: a user id and a season carry no colon, and the
    // circle name is whatever is left — so this cannot be confused by one.
    const first = key.indexOf(":");
    if (first === -1) return false;
    const second = key.indexOf(":", first + 1);
    if (second === -1) return false;
    if (!readers.has(key.slice(0, first))) return false;
    return season === null || key.slice(first + 1, second) === season;
  });
}

/** For tests and for a sync that knows it has changed what these read. */
export function clearTradeCircleCache(): void {
  circleCache.clear();
}
