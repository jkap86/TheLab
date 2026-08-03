import type {
  TradeFacetsPayload,
  TradeLeaguesPayload,
  TradesPagePayload,
} from "@/shared/contract";

import { apiFetch } from "../shared/api.ts";
import { tradeQueryParams } from "./trade-query.ts";
import type { TradeRequest } from "./trade-query.ts";

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
  const params = tradeQueryParams(request);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));

  const res = await apiFetch(`/api/trades?${params}`, {
    signal,
    fallbackError: "Failed to load trades",
  });
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
  const res = await apiFetch(`/api/trades/facets?${tradeQueryParams(request)}`, {
    signal,
    fallbackError: "Failed to load filter options",
  });
  return (await res.json()) as TradeFacetsPayload;
}
