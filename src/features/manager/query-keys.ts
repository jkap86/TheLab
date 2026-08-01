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

/**
 * An `/api/adp` query string reduced to its meaning: every parameter as a
 * `[name, value]` pair, sorted by name.
 *
 * The board is fetched by two consumers — the Players tab's ADP column and the
 * drawer's own board — and they must land on one cache entry or the drawer
 * re-fetches a board the page already has. `adpQueryString` builds both, so in
 * practice they already agree; normalising anyway is what keeps that true when a
 * third caller assembles the same filters in a different order, or sends
 * `limit=1000` where the other sent it first. The pairs are an array rather than
 * an object because a repeated parameter is legal in a query string and an
 * object would silently keep only the last one.
 */
export type NormalizedAdpQuery = readonly (readonly [string, string])[];

export function normalizeAdpQuery(query: string): NormalizedAdpQuery {
  const pairs: [string, string][] = [];
  for (const [name, value] of new URLSearchParams(query)) pairs.push([name, value]);
  pairs.sort((a, b) => (a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0])));
  return pairs;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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

/**
 * The global ADP board and the density strip under its scrubber.
 *
 * Deliberately *not* under the manager prefix: `/api/adp` describes every draft
 * this app has crawled, narrowed by settings — the same board is the same answer
 * whichever manager is being looked at, so scoping it to one would re-fetch an
 * identical board per manager and let a manager-wide invalidation throw away a
 * board that has nothing to do with them.
 */
export const boardQueryKeys = {
  all: ["adp"] as const,
  adp: (query: string) => [...boardQueryKeys.all, "board", normalizeAdpQuery(query)] as const,
  density: () => [...boardQueryKeys.all, "density"] as const,
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
