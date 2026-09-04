import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  KtcFormat,
  LeaguematePayload,
  Trade,
  TradesPagePayload,
} from "@/shared/contract";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { ktcBoardValue } from "@/shared/ktc";
import type { KtcBoards } from "@/shared/ktc";
import { ktcPickPrice, pickTier } from "@/shared/ktc/picks";
import {
  assetKey,
  collectEnrichmentIds,
  countTradeTotals,
  draftOrderKey,
  getDraftSlots,
  getTradeManagers,
  listTrades,
  lookupKtcMarkets,
  lookupLeagueMarkets,
  lookupPlayers,
  parseTradeQuery,
  pickSlotKey,
  readTradeParams,
} from "@/shared/trades";
import type { TradeLeagueMarket, TradeQuery } from "@/shared/trades";

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
 * The names the ids on this page stand for, and what its assets are worth.
 *
 * The five lookups are independent and run together; each is a no-op on an
 * empty id list, which is the common case for every page after the first few.
 * The league *rows* are deliberately still not among them — those arrive whole
 * from `/api/trades/leagues`, once per season — but a league's superflex
 * reading and its size are, because a valuation needs both and the page route
 * has never had a reason to read them until now.
 */
async function resolveNames(trades: readonly Trade[]) {
  // Deduplicated per namespace rather than across all three — see
  // {@link collectEnrichmentIds} for the collision one shared `Set` allowed.
  const {
    players: playerIds,
    managers: managerIds,
    draftKeys,
  } = collectEnrichmentIds(trades);

  const leagueIds = [...new Set(trades.map((t) => t.league_id))];

  const [players, managers, draftSlots, leagueMarkets, ktcMarkets] =
    await Promise.all([
      lookupPlayers(playerIds),
      getTradeManagers(managerIds),
      getDraftSlots(draftKeys),
      lookupLeagueMarkets(leagueIds),
      lookupKtcMarkets(),
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
    // Narrowed to the picks the page actually holds: a league's order covers
    // every roster in it, and a page names two or three of them.
    pickSlots: resolvePickSlots(trades, draftSlots),
    assetValues: resolveAssetValues(
      trades,
      draftSlots,
      leagueMarkets,
      ktcMarkets,
    ),
  };
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

/**
 * What KeepTradeCut prices each asset on this page at, on **both** of its
 * markets.
 *
 * Both, because the reader's `auto`/`dynasty`/`redraft` choice is applied in
 * the browser here — see {@link TradesPagePayload.assetValues} for why that
 * differs from the lineups route, which has to resolve it before it can rank.
 * What is *not* left to the browser is the superflex axis: which of KTC's two
 * QB columns a league reads is a fact about the league, so it is resolved here
 * and only one number per market crosses the wire.
 *
 * Keyed by {@link assetKey}, narrowed to the assets this page actually names —
 * the same rule `resolvePickSlots` follows, and the reason a market of ~500
 * rows does not ship whole behind every scroll.
 *
 * An asset neither market prices is simply absent, which the card reads as an
 * em dash. That includes every FAAB payment, which is not looked up at all: a
 * league's own currency is not something a market prices, and never will be.
 */
function resolveAssetValues(
  trades: readonly Trade[],
  orders: ReadonlyMap<string, ReadonlyMap<number, number>>,
  leagues: ReadonlyMap<string, TradeLeagueMarket>,
  markets: Partial<Record<KtcFormat, KtcBoards>>,
): TradesPagePayload["assetValues"] {
  const values: TradesPagePayload["assetValues"] = {};

  /** Both markets' prices for one asset, or nothing where neither has one. */
  const price = (
    read: (boards: KtcBoards, superflex: boolean) => number | null,
    superflex: boolean,
  ) => {
    const dynasty = markets.dynasty ? read(markets.dynasty, superflex) : null;
    const redraft = markets.redraft ? read(markets.redraft, superflex) : null;
    return dynasty === null && redraft === null ? null : { dynasty, redraft };
  };

  for (const trade of trades) {
    // A league with no stored row prices nothing rather than being guessed at
    // as a 1QB league of unknown size — the read is cached and a miss means the
    // league genuinely is not stored.
    const league = leagues.get(trade.league_id);
    if (!league) continue;
    const { superflex, total_rosters } = league;

    for (const side of trade.sides) {
      for (const id of side.players) {
        const key = assetKey(trade.league_id, id);
        if (key in values) continue;
        const found = price(
          (boards, sf) => ktcBoardValue(sf, boards.values[id]),
          superflex,
        );
        if (found) values[key] = found;
      }

      for (const pick of side.picks) {
        const key = assetKey(trade.league_id, pick);
        if (key in values) continue;
        // The pick's own third of the round where its draft order is set, and
        // null where it is not — most picks on this board are seasons out, and
        // `ktcPickPrice` reads that as "take the untiered row, then the middle
        // one", which is the convention every trade calculator uses.
        const slot = orders
          .get(draftOrderKey(trade.league_id, pick.season))
          ?.get(pick.roster_id);
        const tier =
          slot === undefined ? null : pickTier(slot, total_rosters);
        const found = price((boards, sf) => {
          const match = ktcPickPrice(boards.picks, pick, tier);
          return match ? ktcBoardValue(sf, match.price) : null;
        }, superflex);
        if (found) values[key] = found;
      }
    }
  }

  return values;
}
