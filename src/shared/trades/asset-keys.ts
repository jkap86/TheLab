/**
 * The key one traded asset is priced under, spelled once for both ends.
 *
 * The same arrangement `./pick-slots` is, and for the same reason: the route
 * writes these keys and the trade card reads them, so a second spelling would
 * be a card silently showing no value rather than an error anybody could see.
 * It lives here rather than beside the card because `shared/` must never import
 * from `features/`, and the route is the writer.
 *
 * Pure and free of runtime imports, so the client deep-imports it the way it
 * already reaches `@/shared/ktc/roster`.
 */

/** A future draft pick as it moves in a trade — {@link TradePickAsset}'s shape. */
type PickAsset = { season: string; round: number; roster_id: number };

/**
 * The key an asset is priced under: a player by his Sleeper id, a pick by the
 * identity Sleeper gives it — season, round, and the roster it *originally*
 * belongs to.
 *
 * **League-scoped, which is the part that is silent when wrong.** A pick's own
 * identity describes a different asset in every league on the board, so an
 * unscoped `k:2027:1:5` would have one league's first quietly priced as
 * another's. A player is scoped too, less obviously: two leagues read different
 * markets and different QB columns, so one id is legitimately worth two
 * different numbers on a single page.
 */
export function assetKey(
  leagueId: string,
  asset: string | PickAsset,
): string {
  return typeof asset === "string"
    ? `p:${leagueId}:${asset}`
    : `k:${leagueId}:${asset.season}:${asset.round}:${asset.roster_id}`;
}
