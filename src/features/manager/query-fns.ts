import { fetchJson } from "../shared/api.ts";
import { fetchManagerResource } from "../shared/manager-query.ts";

/**
 * The functions behind the manager queries: one read per resource, the leagues
 * stream decoded into something a query can resolve with, and the invalidation
 * that follows a refreshed stream.
 *
 * Every one of them is a re-export now — each moved to `features/shared` as a
 * second tool started making the same read, which is this codebase's standing
 * habit and not a filing preference. {@link invalidateManagerDependents} was the
 * last to go and is the interesting one: it looked like the only part of the set
 * genuinely about this tool, because it is keyed on the name searched in the URL
 * and no other tool has one. What that missed is that the *entry* it follows is
 * shared — the pick tracker and the lineup checker refresh the same leagues
 * query — so deciding when to call it inside this tool's own hook made the
 * decision conditional on this tool being mounted. It is made at the write now,
 * in `features/shared/leagues-cache`, and this file keeps the name its own
 * consumers and tests already import.
 *
 * The imports are relative and carry a `.ts` extension for the reason `shares`
 * and `record` keep theirs: these are reachable from the test runner. Nothing
 * here holds cache policy — how long an answer stays fresh is `query-config`,
 * and where it is filed is `query-keys`.
 */

// Re-exported under its old name: this module's own consumers (the tests,
// `fetchManagerResource` below) already import it from here, the same
// mover's-rule habit `adp-controls` keeps for `todayIso`.
export { fetchJson };

// The sub-resource read moved to `features/shared/manager-query.ts` with the
// keys it is filed under, once the lineup checker started making two of those
// reads itself. Re-exported under its old name: this module's own consumers —
// `useManagerResource`, and this feature's tests — already import it from here.
export { fetchManagerResource };

// The leagues stream's decoder moved to `features/shared/leagues-stream.ts` once
// a second tool started reading the same protocol — the pick tracker's league
// picker and the lineup checker's list both come off this stream, and while the
// decoder lived here the only way for them to read it was a hand-rolled
// `useEffect` that cached nothing. Re-exported under their old names: this
// feature's own hooks and its tests already import them from here, the same
// mover's-rule habit `fetchManagerResource` above keeps.
export {
  fetchManagerLeagues,
  leaguesRevision,
  refreshSeqOf,
  type LeaguesStreamOptions,
  type ManagerLeaguesData,
} from "../shared/leagues-stream.ts";

// The invalidation and the publisher that decides when to call it live in
// `features/shared/leagues-cache.ts`, beside the entry they are about — three
// tools write that entry and only one of them was doing the comparison.
// Re-exported under its old name: this feature's hooks and its tests already
// import it from here, the same mover's-rule habit above.
export {
  cachedLeaguesRevision,
  dependentsFellBehind,
  invalidateManagerDependents,
  publishManagerLeagues,
} from "../shared/leagues-cache.ts";
