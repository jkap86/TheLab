import { NextResponse } from "next/server";

import type { LeaguematePayload, TradesPagePayload } from "@/shared/contract";
import { ktcPickKey, KTC_PICK_TIERS } from "@/shared/ktc";
import { isSeason } from "@/shared/query";
import { getActiveSeason } from "@/shared/season";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import {
  countTrades,
  draftOrderKey,
  getDraftSlots,
  getStoredTradeCount,
  getTradeManagers,
  hasTradeNarrowing,
  isUnnarrowed,
  leagueScopeQuery,
  listTrades,
  lookupKtc,
  lookupKtcPicks,
  lookupPlayers,
  parseTradeQuery,
  pickSlotKey,
  refreshTradeStats,
} from "@/shared/trades";
import type { Trade, TradeQuery } from "@/shared/trades";

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
  const url = new URL(request.url);
  const requested = url.searchParams.get("season");
  const season =
    requested && isSeason(requested) ? requested : await getActiveSeason();

  const query = parseTradeQuery(url.searchParams, season);

  try {
    const page = await listTrades(query);

    // Both counts run only on a first page, and both are skipped when they are
    // free or knowable without a scan. Started together with the enrichment
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
 * - `scopeTotal` is the league-filtered population, and it is only its own query
 *   when something beyond the league filters is narrowing — otherwise it is the
 *   same number as `total`, and counting it twice would be a scan for a value
 *   already in hand.
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

    if (!hasTradeNarrowing(query)) {
      const total = await countTrades(query);
      return { total, scopeTotal: total };
    }

    const [total, scopeTotal] = await Promise.all([
      countTrades(query),
      countTrades(leagueScopeQuery(query)),
    ]);
    return { total, scopeTotal };
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
  const playerIds: string[] = [];
  const managerIds: string[] = [];
  // The `(league, season)` pairs whose draft order would name a pick on this
  // page. Deduplicated like the ids: a busy league's page carries dozens of
  // picks out of the same two drafts.
  const draftKeys: string[] = [];
  const seen = new Set<string>();
  const take = (id: string, out: string[]) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  // KTC's pick rows the page's picks could land on. Kept in a set of its own
  // rather than sharing `seen`: these keys are built from a season and a round
  // rather than from an id, so they belong to a different namespace and sharing
  // one would only be safe by accident.
  const pickKeys = new Set<string>();

  for (const trade of trades) {
    for (const side of trade.sides) {
      for (const id of side.players) take(id, playerIds);
      if (side.user_id) take(side.user_id, managerIds);
      for (const pick of side.picks) {
        take(draftOrderKey(trade.league_id, pick.season), draftKeys);
        // A pick's original owner need not be a participant, so this is not
        // covered by the side ids above — and it is exactly the case the card
        // names an owner for.
        if (pick.user_id) take(pick.user_id, managerIds);
        // **Every tier, not the one this pick falls in.** Which third of the
        // round a pick lands in is a function of the league's draft order *and*
        // its size, and the size is on the league list the client already holds
        // — so the client resolves the tier and this sends the rows it could
        // resolve to. Four rows per `(season, round)` the page names, of which a
        // page names a handful; resolving the tier here instead would send one
        // entry per pick per league and re-send it on every page a pick from
        // that draft appears in.
        for (const tier of [...KTC_PICK_TIERS, null]) {
          pickKeys.add(ktcPickKey(pick.season, pick.round, tier));
        }
      }
    }
  }

  const [players, managers, ktc, pickKtc, draftSlots] = await Promise.all([
    lookupPlayers(playerIds),
    getTradeManagers(managerIds),
    // Keyed on the same new-ids list as the names, so a player priced once is
    // priced once for the whole board.
    lookupKtc(playerIds),
    lookupKtcPicks([...pickKeys]),
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
    pickKtc: Object.fromEntries(pickKtc),
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
