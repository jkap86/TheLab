import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeaguematePayload,
  Trade,
  TradesPagePayload,
} from "@/shared/contract";
import { getRosProjections, restOfSeasonStart } from "@/shared/projections";
import type { RosProjections } from "@/shared/projections";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState, sleeperAvatarUrl } from "@/shared/sleeper";
import {
  collectEnrichmentIds,
  countTradeTotals,
  draftOrderKey,
  getDraftSlots,
  getTradeLeagueRosters,
  getTradeManagers,
  listTrades,
  lookupKtcMarkets,
  lookupLeagueMarkets,
  lookupPlayers,
  lookupSeasonAdp,
  parseTradeQuery,
  pickSlotKey,
  readTradeParams,
  readTradeValues,
} from "@/shared/trades";
import type { TradeQuery } from "@/shared/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One page of the trades board — see {@link TradesPagePayload} for the payload
 * and what each half of it is for.
 *
 * The handler is arranged around three costs it must not pay:
 *
 * - **No cursor is held.** `listTrades` is one `LIMIT`-bounded keyset query
 *   that finishes and hands its connection back *before* the enrichment below
 *   runs. Interleaving cursor reads with id lookups leaves a pooled connection
 *   idle-in-transaction across every one of them, which at a handful of
 *   concurrent readers is the pool.
 * - **No count per later page.** The denominators are counted on a **first
 *   page** only, so a filter set costs one scan rather than one per scroll.
 * - **No repeated lookups.** Names resolve through the process-level caches in
 *   `shared/trades/enrich`, so a season's few thousand players are read from
 *   Postgres once per TTL rather than once per page per reader.
 *
 * **A page names its own ids and does not try to send a delta.** The client
 * merges each page's maps into what it holds, so the alternative — listing
 * every id it already has, on every request — is a few thousand ids in a query
 * string and a 414 waiting for the reader who scrolls furthest. A
 * self-contained page re-sends the names its own players share with earlier
 * ones, bounded by the page size rather than by the season.
 *
 * **Only the season can fail this request**, and it fails it deliberately:
 * `parseRequestedSeason` answers a malformed `?season=` with a 400, the house
 * rule everywhere in this app, where TheLabX's copy of this route quietly
 * opened the active season instead. Every *other* parameter is a narrowing and
 * the neutral form of a narrowing is not narrowing, so an unreadable one is
 * ignored rather than turning a stale bookmark into an error page.
 *
 * **GET and POST answer the same question**, and the second exists only because
 * the first has a length. A league scope is one id per league the reader's
 * rules did *not* settle (see `features/trades/league-scope`), so a corpus the
 * crawler keeps growing puts the shorter of those lists past what a router will
 * carry on a request line — Heroku answers that with a 431 and an empty body.
 * `readTradeParams` folds a POST's form-encoded body back into the line's
 * parameters, so everything below this reads one `URLSearchParams` and neither
 * the parser nor the SQL knows which method was used. See
 * {@link TradeQuery.leagues}.
 */
export async function GET(request: Request) {
  return readTradesPage(request);
}

export async function POST(request: Request) {
  return readTradesPage(request);
}

async function readTradesPage(request: Request) {
  const read = await readTradeParams(request);
  if (!read.ok) {
    const error: ApiErrorPayload = { error: read.error };
    return NextResponse.json(error, { status: read.status });
  }
  const { params } = read;

  const requested = parseRequestedSeason(params.get("season"));
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  const query = parseTradeQuery(params, season);

  try {
    const page = await listTrades(query);

    // The counts run only on a first page. Started together with the
    // enrichment rather than before it: they are independent queries and the
    // page waits on the slowest, not on the sum.
    const first = query.cursor === null;
    const [totals, names] = await Promise.all([
      first ? resolveTotals(query) : Promise.resolve(EMPTY_TOTALS),
      resolveNames(page.trades, season),
    ]);

    const payload: TradesPagePayload = {
      season,
      trades: page.trades,
      nextCursor: page.nextCursor,
      ...totals,
      ...names,
    };

    return NextResponse.json(payload, {
      headers: {
        // Private and short: the board moves at the sync's pace, and what this
        // buys is the back button and a double-mount in development. A POST
        // forfeits it — no browser caches one — which is the price of a scope
        // too long to put on the line, and is why only the long ones pay it.
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    console.error("[trades] page query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load trades" };
    return NextResponse.json(payload, { status: 500 });
  }
}

const EMPTY_TOTALS = { total: null, scopeTotal: null } as const;

/**
 * The two denominators the page states, from one pass over the population —
 * `scopeTotal` is the league-filtered population and `total` an aggregate
 * `FILTER` over the same scan, since the scope population is a superset of the
 * query's by construction. The case where the two are equal needs no special
 * handling: it is an empty filter over the same count.
 */
async function resolveTotals(
  query: TradeQuery,
): Promise<{ total: number | null; scopeTotal: number | null }> {
  try {
    return await countTradeTotals(query);
  } catch (error) {
    // A denominator, not the list. The page draws a count without a total, so
    // a failed count costs a fraction and never the trades.
    console.error("[trades] count failed:", error);
    return EMPTY_TOTALS;
  }
}

/**
 * The names the ids on this page stand for, and what its assets are worth on
 * each of the board's three bases.
 *
 * The lookups are independent and run together; each is a no-op on an empty id
 * list, which is the common case for every page after the first few. The league
 * *rows* are deliberately still not among them — those arrive whole from
 * `/api/trades/leagues`, once per season — but a league's superflex reading,
 * its size, its lineup, its scoring and its rostered players all are, because a
 * valuation and a rank need every one of them.
 *
 * **Three of the reads are not bounded by the page, and all three are cached
 * behind their own TTL**: the season's ADP aggregate (`lookupSeasonAdp`), the
 * folded projections span (`getRosProjections`, half an hour) and the two KTC
 * markets (`getKtcBoards`, the sync's own fifteen minutes). None of them is
 * re-read per scroll, which is what makes three bases affordable at all.
 *
 * **Every basis degrades on its own.** A failed projections span, an
 * unreadable market and a season with no completed draft each cost that basis
 * and nothing else — the page still answers, and the panel says which basis has
 * nothing to say. A valuation must never fail a page of trades.
 */
async function resolveNames(trades: readonly Trade[], season: string) {
  // Deduplicated per namespace rather than across all three — see
  // {@link collectEnrichmentIds} for the collision one shared `Set` allowed.
  const {
    players: playerIds,
    managers: managerIds,
    draftKeys,
  } = collectEnrichmentIds(trades);

  const leagueIds = [...new Set(trades.map((t) => t.league_id))];

  const [
    players,
    managers,
    draftSlots,
    leagueMarkets,
    leagueRosters,
    ktcMarkets,
    adp,
    projections,
  ] = await Promise.all([
    lookupPlayers(playerIds),
    getTradeManagers(managerIds),
    getDraftSlots(draftKeys),
    lookupLeagueMarkets(leagueIds),
    getTradeLeagueRosters(leagueIds),
    lookupKtcMarkets(),
    resolveSeasonAdp(season),
    resolveProjections(season),
  ]);

  const resolvedManagers: Record<string, LeaguematePayload> = {};
  for (const [id, m] of managers) {
    resolvedManagers[id] = {
      user_id: id,
      display_name: m.display_name,
      avatar_url: sleeperAvatarUrl(m.avatar, "thumb"),
    };
  }

  const { assetValues, values } = readTradeValues({
    trades,
    leagues: leagueMarkets,
    rosters: leagueRosters,
    orders: draftSlots,
    adp,
    projections: projections.board,
    fromWeek: projections.fromWeek,
    markets: ktcMarkets,
  });

  return {
    players: Object.fromEntries(players),
    managers: resolvedManagers,
    // Narrowed to the picks the page actually holds: a league's order covers
    // every roster in it, and a page names two or three of them.
    pickSlots: resolvePickSlots(trades, draftSlots),
    assetValues,
    values,
  };
}

/** The empty capital board — what a season with no stored drafts prices. */
const NO_ADP = { superflex: new Map(), standard: new Map() };

/**
 * The season's draft-capital board, or an empty one.
 *
 * A basis, not the page: a failed aggregate costs the capital column its
 * numbers and the panel says the basis has nothing to price against, which is
 * the same degradation the lineups route makes of an account with no synced
 * drafts.
 */
async function resolveSeasonAdp(season: string) {
  try {
    return await lookupSeasonAdp(season);
  } catch (error) {
    console.warn(`[trades] draft capital unavailable for ${season}:`, error);
    return NO_ADP;
  }
}

/**
 * The rest-of-season projections span, on the same three readings the lineups
 * and timeline routes take: a past season has no span at all, a failed fetch
 * leaves the basis empty, and neither fails the request.
 */
async function resolveProjections(
  season: string,
): Promise<{ board: RosProjections; fromWeek: number | null }> {
  const fromWeek = await restOfSeasonStart(season, getNflState).catch(() => null);
  if (fromWeek === null) return { board: {}, fromWeek: null };
  try {
    return { board: await getRosProjections(season, fromWeek), fromWeek };
  } catch (error) {
    console.warn(`[trades] projections unavailable for ${season}:`, error);
    return { board: {}, fromWeek: null };
  }
}

/**
 * The slot for each pick on the page, where its league's order is known.
 *
 * A whole league's order is what the query returns (one row per roster, since
 * that is one index walk rather than one per pick), and what crosses the wire
 * is only the cells the picks here land on — the same rule the id lookups
 * follow.
 */
function resolvePickSlots(
  trades: readonly Trade[],
  orders: ReadonlyMap<string, ReadonlyMap<number, number>>,
): Record<string, number> {
  const slots: Record<string, number> = {};
  for (const trade of trades) {
    for (const side of trade.sides) {
      for (const pick of side.picks) {
        const order = orders.get(draftOrderKey(trade.league_id, pick.season));
        const slot = order?.get(pick.roster_id);
        if (slot === undefined) continue;
        slots[pickSlotKey(trade.league_id, pick.season, pick.roster_id)] = slot;
      }
    }
  }
  return slots;
}
