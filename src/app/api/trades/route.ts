import { NextResponse } from "next/server";

import type { LeaguematePayload, TradesPagePayload } from "@/shared/contract";
import { isSeason } from "@/shared/query";
import { getActiveSeason } from "@/shared/season";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import {
  collectEnrichmentIds,
  countTradeTotals,
  draftOrderKey,
  getDraftSlots,
  getStoredTradeCount,
  getTradeManagers,
  isUnnarrowed,
  listTrades,
  lookupKtc,
  lookupKtcPickBoard,
  lookupPlayers,
  parseTradeQuery,
  parseTradeScopeBody,
  pickSlotKey,
  refreshTradeStats,
} from "@/shared/trades";
import type { Trade, TradeQuery, TradeScopeBody } from "@/shared/trades";

import { readFailureResponse } from "../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One page of the trades board — see {@link TradesPagePayload} for the payload
 * and what each half of it is for.
 *
 * **This route replaced a whole-season NDJSON stream, and the shape of it is the
 * point.** The stream was a good answer to a constraint that no longer holds:
 * the page filtered in the browser, so the browser needed everything, so the
 * only lever left was making ~20MB arrive progressively. With the filters here,
 * a reader downloads the two hundred trades they are looking at.
 *
 * Four costs went with the stream, and the handler is arranged around not paying
 * them again:
 *
 * - **No cursor is held.** `listTrades` is one `LIMIT`-bounded keyset query that
 *   finishes and hands its connection back *before* the enrichment below runs.
 *   The old handler interleaved cursor reads with four id lookups per chunk, so
 *   a pooled connection sat idle-in-transaction across every one of them — at a
 *   handful of concurrent readers, that was the pool.
 * - **No count per request.** The unnarrowed total comes off `trade_market_stats`
 *   (a stored row, refreshed by the crawler that writes the trades); a narrowed
 *   one is counted, but only on a **first page**, so a filter set costs one scan
 *   rather than one per page.
 * - **No repeated lookups.** The names are resolved through the process-level
 *   caches in `shared/trades/enrich`, so a season's few thousand players are
 *   read from Postgres once per TTL rather than once per page per reader.
 *
 * **A page names its own ids and does not try to send a delta**, which is the
 * one thing the stream did that this deliberately drops. The stream held a `Set`
 * of what it had already sent, so a player crossed the wire once per season;
 * pages are separate requests, so the equivalent would be the client listing
 * everything it holds on each one — a few thousand ids in a query string, which
 * is a 414 waiting for the reader who scrolls furthest. A self-contained page
 * re-sends the names its ~400 distinct players share with earlier pages, which
 * is ~8KB compressed and bounded by the page size rather than by the season. The
 * client still merges rather than replaces, so the maps only ever grow.
 *
 * The season is the only parameter with a default (the active one), and nothing
 * else can fail the request: every filter is a narrowing, and the neutral form
 * of a narrowing is not narrowing, so an unreadable value is ignored rather than
 * turning a stale bookmark into a 400.
 */
export async function GET(request: Request) {
  return readTrades(request);
}

/**
 * The same read, for a league scope too long to put on a request line.
 *
 * **It exists so that "too many leagues to name" stops meaning "don't narrow".**
 * The client used to fall back to filtering pages in the browser past ~500 ids,
 * which is not a degradation but a wrong answer: a page whose two hundred trades
 * are all excluded renders as an empty board, the list unmounts, nothing asks
 * for page two, and the counts describe a population the reader cannot see.
 *
 * It is a POST only because a body is where a long list fits — nothing about it
 * is a write. Everything else is byte-for-byte the GET: the same query string,
 * the same {@link parseTradeQuery}, the same keyset cursor, the same SQL and the
 * same counts, so the two methods cannot answer differently. A body that isn't
 * readable JSON narrows nothing rather than failing the request, the rule every
 * other field here follows.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  return readTrades(request, parseTradeScopeBody(body));
}

async function readTrades(request: Request, scope?: TradeScopeBody) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("season");
  const season =
    requested && isSeason(requested) ? requested : await getActiveSeason();

  const query = parseTradeQuery(url.searchParams, season, scope);

  try {
    const page = await listTrades(query);

    // The counts run only on a first page, and are skipped entirely when the
    // number is knowable without a scan. Started together with the enrichment
    // rather than before it: they are independent queries and the page waits on
    // the slowest, not on the sum.
    const first = query.cursor === null;
    const [totals, names] = await Promise.all([
      first ? resolveTotals(query) : Promise.resolve(EMPTY_TOTALS),
      resolveNames(page.trades),
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
        // Private and short: the board moves at the crawler's pace, and the
        // client's own React Query entry is the cache that matters. What this
        // buys is the back button and a double-mount in development.
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    console.error("[trades] page query failed:", error);
    return readFailureResponse(error, "Failed to load trades");
  }
}

const EMPTY_TOTALS = { total: null, scopeTotal: null } as const;

/**
 * The two denominators the page states, each computed the cheapest way that is
 * still exact.
 *
 * - Unnarrowed, `total` is the stored count and no scan happens at all. A season
 *   the refresh has never reached counts once and stores it, so the first reader
 *   after a deploy pays what every reader used to.
 * - Narrowed, both come off one pass: `scopeTotal` is the league-filtered
 *   population and `total` an aggregate `FILTER` over the same scan, since the
 *   scope population is a superset of the query's by construction. The case
 *   where the two are equal needs no special handling any more — it is an empty
 *   filter over the same count rather than a second query skipped by hand.
 */
async function resolveTotals(
  query: TradeQuery,
): Promise<{ total: number | null; scopeTotal: number | null }> {
  try {
    if (isUnnarrowed(query)) {
      const stored = await getStoredTradeCount(query.season);
      const total = stored ?? (await refreshTradeStats(query.season));
      return { total, scopeTotal: total };
    }

    // One pass over the scope population answers both, including the case where
    // they are the same number — see {@link countTradeTotals}. It used to be two
    // counts in parallel, which was two scans of nearly the same rows and two
    // pooled connections held for the length of them.
    return await countTradeTotals(query);
  } catch (error) {
    // A denominator, not the list. The page draws a count without a total the
    // same way it drew one mid-stream, so a failed count costs a percentage and
    // never the trades.
    console.error("[trades] count failed:", error);
    return EMPTY_TOTALS;
  }
}

/**
 * The names the ids on this page stand for.
 *
 * The five lookups are independent and run together; each is a no-op on an
 * empty id list, which is the common case for every page after the first few.
 * Leagues are deliberately **not** among them — they arrive whole from
 * `/api/trades/leagues`, once per season, which is what removed the stream's
 * per-chunk league resolution entirely.
 */
async function resolveNames(trades: readonly Trade[]) {
  // Deduplicated per namespace rather than across all three — see
  // {@link collectEnrichmentIds} for the collision one shared `Set` allowed.
  const {
    players: playerIds,
    managers: managerIds,
    draftKeys,
  } = collectEnrichmentIds(trades);

  const [players, managers, ktc, pickKtc, draftSlots] = await Promise.all([
    lookupPlayers(playerIds),
    getTradeManagers(managerIds),
    // Keyed on the same new-ids list as the names, so a player priced once is
    // priced once for the whole board.
    lookupKtc(playerIds),
    // **The whole board, not the rows this page's picks land on.** It used to be
    // narrowed to four rows per `(season, round)` named here, on the reasoning
    // that the client resolves a pick's tier and so needs every tier of the
    // rows it might read — still true, and no longer sufficient. The ADP column
    // discounts a future pick by the ratio of its KTC row to the *nearest
    // priced season's*, and which season that is is a fact about the board
    // rather than about any pick on the page: a page naming no 2027 pick could
    // not have computed it from a narrowed read. The board is a few dozen rows
    // and one query, so it is simply sent whole.
    lookupKtcPickBoard(),
    getDraftSlots(draftKeys),
  ]);

  const resolvedManagers: Record<string, LeaguematePayload> = {};
  for (const [id, m] of managers) {
    resolvedManagers[id] = {
      user_id: id,
      display_name: m.display_name,
      avatar_url: sleeperAvatarUrl(m.avatar, "thumb"),
    };
  }

  return {
    players: Object.fromEntries(players),
    managers: resolvedManagers,
    ktc: Object.fromEntries(ktc),
    // Already a plain record — the board is read whole rather than resolved
    // through the keyed cache the three lookups above return maps from.
    pickKtc,
    // Narrowed to the picks the page actually holds: a league's order covers
    // every roster in it, and a page names two or three of them.
    pickSlots: resolvePickSlots(trades, draftSlots),
  };
}

/**
 * The slot for each pick on the page, where its league's order is known.
 *
 * A whole league's order is what the query returns (one row per roster, since
 * that is one index walk rather than one per pick), and what crosses the wire is
 * only the cells the picks here land on — the same rule the id lookups follow.
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
