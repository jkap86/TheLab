/**
 * The header's public face, and deliberately only that.
 *
 * Its call sites reach it as `@/features/shared/ui/manager-header`, so this file
 * is what that path resolves to now the card is a folder. The sections are this
 * folder's business: the plate's corners, the summary row, the readout and the
 * state line have no reader outside it, and an export a barrel could pick up is
 * how an internal part ends up somewhere it was never meant to be rendered.
 *
 * **It is not re-exported from `features/shared/index.ts`, and that is the
 * point.** The card pulls in the countdown, the dial and a React Query hook;
 * from the barrel it would join the graph of every page that imports anything
 * shared, including the three that draw no plate at all. Two call sites naming
 * the module path is the same rule the ADP drawer and the league filters dialog
 * keep.
 */
export { ManagerHeader } from "./manager-header";
export type {
  HeaderSeasonControl,
  HeaderStat,
} from "./manager-header.types";
