/**
 * Where a traded draft pick will actually fall, and how a page names one.
 *
 * A pick is stored as a season, a round and the roster it *originally* belongs
 * to — which is what it is, but not what a reader calls it once the draft order
 * is set. Sleeper names an ordered pick by its slot ("2026 1.05") and an
 * unordered one by its round ("2026 1st"), and the difference is a fact about
 * the league's draft rather than about the trade, so it is resolved here and
 * travels beside the page rather than being folded into the pick.
 *
 * Folded in, it would have to be written by {@link assembleTrade} — a pure
 * function over one stored row that would then need a second table behind it —
 * and it would ride on every copy of a pick rather than once per roster. Keyed,
 * a page names each `(league, season, roster)` once whether it appears in one
 * trade or forty.
 *
 * Pure and free of runtime imports, so the client can deep-import it (the way it
 * reaches `@/shared/ktc/roster`) and read the same keys the route wrote.
 */

/**
 * The key a resolved slot is stored under: the league whose draft it is, the
 * season that draft is for, and the roster the pick originally belongs to.
 *
 * All three are needed and none is redundant — one league's 2026 order says
 * nothing about another's, a league's 2026 and 2027 orders are different orders,
 * and the whole point of the lookup is which roster's slot this is.
 */
export function pickSlotKey(
  leagueId: string,
  season: string,
  rosterId: number,
): string {
  return `${leagueId}|${season}|${rosterId}`;
}

/**
 * The `(league, season)` pair one draft order is looked up by — the cache key
 * behind {@link pickSlotKey}, since a league's whole order is one query and one
 * entry however many of its rosters a page names.
 *
 * The separator is `|` because a Sleeper league id and a season are both digits,
 * so it cannot appear inside either half — which is what lets the query split
 * these back apart with `split_part` rather than binding two parallel arrays.
 */
export function draftOrderKey(leagueId: string, season: string): string {
  return `${leagueId}|${season}`;
}
