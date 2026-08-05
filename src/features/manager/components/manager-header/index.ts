/**
 * The header's public face, and deliberately only that.
 *
 * Its one call site reaches it as `./manager-header`, so this file is what that
 * path resolves to now the card is a folder — `leagues-view-layout` is unchanged.
 * The sections are this folder's business: the plate's corners, the summary row,
 * the readout and the state line have no reader outside it, and an export the
 * feature barrel could pick up is how an internal part ends up somewhere it was
 * never meant to be rendered.
 */
export { ManagerHeader } from "./manager-header";
export type { HeaderStat } from "./manager-header.types";
