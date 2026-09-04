// The timeline: a rail over a league's stored moves, and the past it reads.
//
// **A module path rather than an entry on `features/shared/index.ts`.** That
// barrel is imported by every page in the app, and this subtree pulls in a fetch
// hook, the rewind and two dense views — from the barrel it would join the graph
// of the four pages that have no rail to draw. It is the same exception
// `local-store.ts` is, argued from the other side: there a module only the
// barrel's siblings build on, here one whose single host names this path.

export { TimelineView } from "./timeline-view";
export { TimelineRail } from "./timeline-rail";
