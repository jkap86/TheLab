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
// its old name for this feature's own consumers.
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
   * Every steepness of one manager's ADP valuation — the prefix, not an entry.
   * Dependent invalidation addresses the board as a whole; a single curve is
   * {@link managerQueryKeys.adpValue}, which appends the number.
   */
  adpValues: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "adp-value", seasonKey(season)] as const,

  /**
   * One curve of it. Steepness is in the key rather than being a reason to
   * invalidate: every notch is a different valuation of the same rosters, so
   * dragging the slider back to a value already read should cost no request.
   */
  adpValue: (searched: string, season: string | undefined, steepness: number | string) =>
    [...managerQueryKeys.adpValues(searched, season), String(steepness)] as const,
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
