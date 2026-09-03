import { draftOrderKey } from "./pick-slots.ts";
import type { Trade } from "@/shared/contract";

/**
 * The ids a page of trades needs resolved, deduplicated **per namespace**.
 *
 * **They used to share one `Set`, which is a collision waiting for the right
 * pair of ids.** A player id and a Sleeper user id are both bare digit strings —
 * different lengths in practice, and nothing anywhere promises that — so a page
 * naming player `4034` and manager `4034` used to collect whichever came first
 * and silently drop the other. What that costs is not an error: it is a card
 * with a player's name missing, or a side labelled by a roster number, on one
 * page of one board, which is the kind of thing nobody reports and nobody can
 * reproduce.
 *
 * Pure and separate from the route for the usual reason: the deduplication *is*
 * the logic, and a test can call this where it cannot call a route handler.
 */
export type TradeEnrichmentIds = {
  /** Every player who moved, whichever side took them. */
  players: string[];
  /** Every side's owner, plus every named pick's original owner. */
  managers: string[];
  /** The `(league, season)` pairs whose draft order would name a pick here. */
  draftKeys: string[];
};

export function collectEnrichmentIds(
  trades: readonly Trade[],
): TradeEnrichmentIds {
  const players = new Namespace();
  const managers = new Namespace();
  const draftKeys = new Namespace();

  for (const trade of trades) {
    for (const side of trade.sides) {
      for (const id of side.players) players.take(id);
      if (side.user_id) managers.take(side.user_id);
      for (const pick of side.picks) {
        // Deduplicated like the ids: a busy league's page carries dozens of
        // picks out of the same two drafts.
        draftKeys.take(draftOrderKey(trade.league_id, pick.season));
        // A pick's original owner need not be a participant, so this is not
        // covered by the side ids above — and it is exactly the case the card
        // names an owner for.
        if (pick.user_id) managers.take(pick.user_id);
      }
    }
  }

  return {
    players: players.values,
    managers: managers.values,
    draftKeys: draftKeys.values,
  };
}

/** An ordered, deduplicated id list — one per kind of thing being resolved. */
class Namespace {
  readonly values: string[] = [];
  private readonly seen = new Set<string>();

  take(id: string): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.values.push(id);
  }
}
