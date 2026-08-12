import type {
  TradeFacetsPayload,
  TradeLeaguesPayload,
  TradeRostersPayload,
  TradeTimelinePayload,
  TradesPagePayload,
} from "@/shared/contract";

import { apiFetch } from "../shared/api.ts";
import { tradeHttpRequest } from "./trade-query.ts";
import type { TradeHttpRequest, TradeRequest } from "./trade-query.ts";

/**
 * The three fetches the trades board is built from.
 *
 * They live apart from the hooks for the reason `fetchManagerLeagues` does — a
 * function taking its inputs as arguments is one a test can call, where the same
 * logic inside a hook is only reachable through a renderer. The imports are
 * relative with a `.ts` extension for the same reason.
 *
 * **All three are ordinary JSON now.** The board used to be one NDJSON stream of
 * a whole season, decoded and folded here and published into the cache as it
 * arrived — a lot of machinery (`./stream`, a publish cadence, a trailing timer)
 * whose entire job was making ~20MB tolerable. Filtering and paginating on the
 * server removed the 20MB, and with it the reason for any of that: a page is
 * ~80KB and lands in one response, so `fetch` and `res.json()` is the whole of
 * it. What replaced the progressive feel is `useInfiniteQuery` — the first page
 * is on screen in the time the stream's first chunk used to take, and the rest
 * follow the scroll rather than the connection.
 */

/**
 * Send one trades read, as a GET or — where the league scope is too long for a
 * request line — as a POST carrying the ids as JSON.
 *
 * The two are one function because they must stay one *question*: the query
 * string is identical either way, the route parses it the same way, and the only
 * difference is where the league ids were read from. A caller never chooses;
 * {@link tradeHttpRequest} does, off the size of the scope.
 */
async function sendTradeRequest(
  path: string,
  http: TradeHttpRequest,
  fallbackError: string,
  signal?: AbortSignal,
): Promise<Response> {
  return apiFetch(`${path}?${http.search}`, {
    signal,
    fallbackError,
    ...(http.body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(http.body),
        }
      : null),
  });
}

/** One page of the board. `cursor` is null for the first. */
export async function fetchTradesPage({
  request,
  cursor,
  limit,
  signal,
}: {
  request: TradeRequest;
  cursor: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<TradesPagePayload> {
  const res = await sendTradeRequest(
    "/api/trades",
    tradeHttpRequest(request, { cursor, limit }),
    "Failed to load trades",
    signal,
  );
  return (await res.json()) as TradesPagePayload;
}

/**
 * Every league with a trade this season — the league rules' input, and the name
 * every card puts on its league.
 *
 * One request per season rather than a slice of every page, which is what its
 * being a separate route buys: a few hundred leagues' worth of settings blobs
 * would otherwise ride along with every scroll for the sake of the handful a
 * page happens to name.
 */
export async function fetchTradeLeagues({
  season,
  signal,
}: {
  season: string;
  signal?: AbortSignal;
}): Promise<TradeLeaguesPayload> {
  const res = await apiFetch(
    `/api/trades/leagues?season=${encodeURIComponent(season)}`,
    { signal, fallbackError: "Failed to load leagues" },
  );
  return (await res.json()) as TradeLeaguesPayload;
}

/**
 * The filter dialog's menus.
 *
 * `request` should carry the league scope and the window but *not* the draft
 * selection — the route lifts the selection out either way, and sending it would
 * only make the cache key change on every checkbox for an answer that cannot.
 */
export async function fetchTradeFacets({
  request,
  signal,
}: {
  request: TradeRequest;
  signal?: AbortSignal;
}): Promise<TradeFacetsPayload> {
  const res = await sendTradeRequest(
    "/api/trades/facets",
    tradeHttpRequest(request),
    "Failed to load filter options",
    signal,
  );
  return (await res.json()) as TradeFacetsPayload;
}

/**
 * What each side of one trade held immediately before it.
 *
 * **A plain GET with no scope machinery**, which is what separates it from the
 * three above: those describe a *population* and so carry the league scope in a
 * query string or a body, where this asks about one stored trade. There is
 * nothing here that could outgrow a request line.
 */
export async function fetchTradeRosters({
  transactionId,
  signal,
}: {
  transactionId: string;
  signal?: AbortSignal;
}): Promise<TradeRostersPayload> {
  const res = await apiFetch(
    `/api/trades/rosters?trade=${encodeURIComponent(transactionId)}`,
    { signal, fallbackError: "Failed to load rosters" },
  );
  return (await res.json()) as TradeRostersPayload;
}

/**
 * The league behind one trade, at every moment from that trade to today.
 *
 * A plain GET for {@link fetchTradeRosters}' reason — one stored trade rather
 * than a population, so there is nothing here that could outgrow a request line.
 * What comes back is the league's log rather than a roster per moment, which is
 * what makes the sheet's rail free to drag: see {@link TradeTimelinePayload}.
 */
export async function fetchTradeTimeline({
  transactionId,
  signal,
}: {
  transactionId: string;
  signal?: AbortSignal;
}): Promise<TradeTimelinePayload> {
  const res = await apiFetch(
    `/api/trades/timeline?trade=${encodeURIComponent(transactionId)}`,
    { signal, fallbackError: "Failed to load the league's timeline" },
  );
  return (await res.json()) as TradeTimelinePayload;
}
