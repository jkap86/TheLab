/**
 * The timeline: a rail over a league's stored moves, and the past it reads.
 *
 * **A module path rather than an entry on `features/shared/index.ts`**, the rule
 * the ADP drawer and the league filters dialog already keep: this subtree pulls in
 * a query hook and two dense views, and from that barrel it would join the graph
 * of every page importing anything shared — including the four that have no rail
 * to draw. Both hosts name this path.
 *
 * {@link TimelineView} is what a host wants; the two views below it are exported
 * for the render tests that pin their markup.
 */
export { TimelineView } from "./timeline-view";
export { TimelineRail } from "./timeline-rail";
export { TimelineRosters } from "./timeline-rosters";
export type { TimelineManager } from "./timeline-rosters";
