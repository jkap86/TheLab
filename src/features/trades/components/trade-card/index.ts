/**
 * The card's public face, and deliberately only that.
 *
 * `TradesList` reaches it as `./trade-card`, so this file is what that path
 * resolves to now the card is a folder — the import is unchanged and so is the
 * component it names. Nothing else is exported: the header, the side plate and
 * the asset tracks are this folder's business, and an export the feature barrel
 * could pick up is how a part ends up in the graph of a page that has no card to
 * draw (see `features/shared/index.ts` for the case that cost bytes).
 */
export { TradeCard } from "./trade-card";
