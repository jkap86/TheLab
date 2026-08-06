/**
 * The query keys every manager read is cached under.
 *
 * The three manager tabs are three routes, so each navigation unmounts the hooks
 * that held the data and the next tab re-asked for it. TanStack Query is what
 * outlives that — but only if both tabs spell the key the same way, which is why
 * the keys are built here rather than at each call site. A key that differs by a
 * stray `undefined` is not a shared cache entry, it is a second request that
 * looks like a hit in the code and a miss in the network panel.
 *
 * Pure, and imported by the tests relatively with a `.ts` extension: it holds no
 * runtime dependency at all, which is what lets the cache behaviour be tested
 * without a fetch or a renderer behind it.
 *
 * Two conventions worth keeping:
 *
 * - **Everything manager-scoped hangs off `manager(searched)`**, whose first act
 *   is to lower-case the searched name. Sleeper resolves `Jkap` and `jkap` to
 *   the same account, and two cache entries for one manager is the duplicate
 *   request this module exists to remove.
 * - **`season` is always in the key, `"default"` when the caller doesn't name
 *   one.** The routes default it server-side, so an omitted season is a real
 *   selection — but it is a *different* selection from an explicit season, and a
 *   key that dropped the segment would let one overwrite the other.
 */

/** A season segment, with the caller's omission spelled out rather than dropped. */
const seasonKey = (season?: string): string => season ?? "default";

/** The manager as the cache spells them — see the lower-casing note above. */
const managerKey = (searched: string): string => searched.toLowerCase();

// The board's own query key moved to `features/shared` once the trades page
// started reading the same board — it was never manager-scoped to begin with
// (see `boardQueryKeys`'s own note), so a second feature reading it is the
// mover's rule applying to a key rather than a component. Re-exported under
// its old name for this feature's own consumers, and *imported* beside that
// because the ADP valuation's own key normalises with it: a re-export puts a
// name on this module's surface without putting it in scope.
import { normalizeAdpQuery } from "../shared/adp-query.ts";

export {
  boardQueryKeys,
  normalizeAdpQuery,
  type NormalizedAdpQuery,
} from "../shared/adp-query.ts";

export const managerQueryKeys = {
  /** Every manager-scoped entry, for a blunt "drop it all" invalidation. */
  all: ["manager"] as const,

  manager: (searched: string) => [...managerQueryKeys.all, managerKey(searched)] as const,

  leagues: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "leagues", seasonKey(season)] as const,

  players: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "players", seasonKey(season)] as const,

  leaguemates: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "leaguemates", seasonKey(season)] as const,

  ranks: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "ranks", seasonKey(season)] as const,

  ktc: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "ktc", seasonKey(season)] as const,

  /**
   * Every board of one manager's ADP valuation — the prefix, not an entry.
   * Dependent invalidation addresses the valuation as a whole; a single board is
   * {@link managerQueryKeys.adpValue}, which appends it.
   */
  adpValues: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "adp-value", seasonKey(season)] as const,

  /**
   * One board of it — the drawer's whole selection, curve included, as the
   * `/api/user/[username]/adp-value` query string.
   *
   * In the key rather than a reason to invalidate: every board is a different
   * valuation of the same rosters, so returning to one already read — dragging
   * the steepness slider back a notch, widening the window and narrowing it
   * again — should cost no request. It used to be the steepness alone, because
   * that was the only thing the route took; now that the board narrows the
   * population too, a key holding less than the request does is a key that
   * serves one board's answer for another.
   *
   * Normalised the same way `boardQueryKeys.adp` normalises its own, so two
   * assemblies of one board land on a single entry rather than on two holding
   * identical payloads.
   */
  adpValue: (searched: string, season: string | undefined, board: string) =>
    [...managerQueryKeys.adpValues(searched, season), normalizeAdpQuery(board)] as const,
};

/** `/api/league/[leagueId]` — the expanded card's standings and rosters. */
export const leagueQueryKeys = {
  all: ["league"] as const,
  detail: (leagueId: string) => [...leagueQueryKeys.all, leagueId] as const,
};

/** `/api/kickoff` — the header countdown's instant, per season. */
export const scheduleQueryKeys = {
  kickoff: (season: string) => ["kickoff", season] as const,
};

/**
 * What a *material* change to a manager's leagues makes stale.
 *
 * These five routes read the rosters and membership the leagues stream writes,
 * so when a refresh actually rewrites them the answers on screen are behind. The
 * list is deliberately short of two things it might look like it should hold:
 * the leagues entry itself (it is the thing that changed, and it holds the new
 * data already) and the ADP board (a fact about the crawled database, not about
 * this manager). Invalidating everything after every stream message is the
 * behaviour this replaces — see `leaguesRevision`, which decides *when*.
 */
export function dependentManagerQueryKeys(
  searched: string,
  season?: string,
): readonly (readonly unknown[])[] {
  return [
    managerQueryKeys.players(searched, season),
    managerQueryKeys.leaguemates(searched, season),
    managerQueryKeys.ranks(searched, season),
    managerQueryKeys.ktc(searched, season),
    // The prefix, so every steepness of the valuation goes with them.
    managerQueryKeys.adpValues(searched, season),
  ];
}
