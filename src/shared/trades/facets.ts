import type { LeaguematePayload, TradeFacetsPayload } from "@/shared/contract";
import { sleeperAvatarUrl } from "@/shared/sleeper";

import { lookupPlayers } from "./enrich";
import { facetsQuery } from "./params";
import type { TradeQuery } from "./params";
import { getTradeFacets, getTradeManagers } from "./queries";

/**
 * The search panel's menus, assembled into the payload it draws.
 *
 * The assembly lives here rather than in the route for two reasons: the
 * selection is dropped before the population is counted, which is a domain rule
 * about what a menu *means* rather than an HTTP one; and the names are half the
 * answer, so the two halves belong in one function.
 *
 * **TheLabX memoises this behind a TTL'd promise cache** (`facets-cache.ts`,
 * whose key is what strips the selection). There is none here: this corpus is
 * fed by manager lookups rather than a crawler, the three aggregates run over
 * it in milliseconds, and a reader who never opens the panel never asks at all.
 * The one rule that cache carried — count without the selection — is
 * {@link facetsQuery}, so it is a named step rather than a property of a key.
 */

/**
 * Names for the ids the menus will show, and nothing more.
 *
 * Picks need none — a pick's label is a pure formatting of the token beside it
 * (`"2026-1"` → `"2026 1st"`) and the client owns that function already, so
 * sending it would be sending a string derivable from the one it sits next to.
 */
async function loadTradeFacets(query: TradeQuery): Promise<TradeFacetsPayload> {
  const facets = await getTradeFacets(query);

  const [players, managers] = await Promise.all([
    lookupPlayers(facets.players.map((f) => f.value)),
    getTradeManagers(facets.managers.map((f) => f.value)),
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
    season: query.season,
    managers: facets.managers,
    players: facets.players,
    picks: facets.picks,
    names: {
      players: Object.fromEntries(players),
      managers: resolvedManagers,
    },
  };
}

/**
 * The menus for one scope.
 *
 * **The selection is stripped here rather than by the caller**, which is the
 * whole reason this wrapper exists: a menu counted over its own selection
 * collapses to that selection the moment you make one, and a route that has to
 * remember to call `facetsQuery` first is a route that will one day forget.
 */
export function readTradeFacets(
  query: TradeQuery,
): Promise<TradeFacetsPayload> {
  return loadTradeFacets(facetsQuery(query));
}
