export { LeagueDetailPanel } from "./league-detail-panel";

/**
 * The league standings-and-rosters panel, behind its own barrel.
 *
 * **It is not on `features/shared/index.ts`**, and that is the same call the
 * manager plate and the ADP drawer make there: this folder pulls in two metric
 * catalogues, a draft-pick list, two settings lists and a query hook, so from
 * that barrel it would join the static graph of every page importing anything
 * shared — `/tools` and `/picktracker` among them, which have nothing to open it
 * with.
 * Both call sites name this module path instead, and the trades board's is a
 * `dynamic()` behind the press that opens it.
 */
