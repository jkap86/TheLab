import type {
  TradeFacetsPayload,
  TradeLeaguesPayload,
  TradesPagePayload,
} from "@/shared/contract";

import { apiFetch } from "../shared/api/api-fetch.ts";
import { tradeHttpRequest, tradeQueryParams } from "./trade-query.ts";
import type { TradeRequest } from "./trade-query.ts";

/**
 * The three fetches the trades board is built from.
 *
 * They live apart from the hooks for the reason `fetchManagerLeagues` does — a
 * function taking its inputs as arguments is one a test can call, where the same
 * logic inside a hook is only reachable through a renderer. The imports are
 * relative with a `.ts` extension for the same reason.
 *
 * **All three are reads and none of them streams.** Filtering and paginating on
 * the server is what makes that enough: a page lands in one response, so
 * `fetch` and `res.json()` is the whole of it, and what carries the progressive
 * feel is the paging hook rather than a stream. The leagues read is a plain GET
 * and always will be; the two that carry a league scope become POSTs once that
 * scope outgrows a request line, which is transport rather than a difference in
 * what they are — see {@link tradeHttpRequest}.
 */

/**
 * One trades read.
 *
 * The parameters are the request, and {@link tradeHttpRequest} decides only how
 * they travel: everything fits on the line, or the league scope moves into a
 * form-encoded body and the route folds it back before anything reads it.
 */
function sendTradeRequest(
  path: string,
  params: URLSearchParams,
  fallbackError: string,
  signal?: AbortSignal,
): Promise<Response> {
  const { method, search, body } = tradeHttpRequest(params);
  return apiFetch(`${path}?${search}`, {
    method,
    body,
    // Named only where there is a body, so a GET is not given a content type
    // for a payload it does not have.
    headers:
      body === null
        ? undefined
        : { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
    fallbackError,
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
  const search = tradeQueryParams(request);
  if (cursor) search.set("cursor", cursor);
  if (limit) search.set("limit", String(limit));

  const res = await sendTradeRequest(
    "/api/trades",
    search,
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
 * The search panel's menus.
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
    tradeQueryParams(request),
    "Failed to load filter options",
    signal,
  );
  return (await res.json()) as TradeFacetsPayload;
}
