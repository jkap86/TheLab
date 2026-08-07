import type { QueryClient } from "@tanstack/react-query";

import { fetchJson } from "../shared/api.ts";
import { fetchManagerResource } from "../shared/manager-query.ts";
import { dependentManagerQueryKeys } from "./query-keys.ts";

/**
 * The functions behind the manager queries: one read per resource, the leagues
 * stream decoded into something a query can resolve with, and the one
 * invalidation this tool performs.
 *
 * The first two are re-exports now — both moved to `features/shared` as a second
 * tool started making the same read, which is this codebase's standing habit and
 * not a filing preference. What is still *written* here is
 * {@link invalidateManagerDependents}, which is the only part of the set that is
 * genuinely about this tool: it is keyed on the name searched in the URL, and no
 * other tool has one.
 *
 * It lives apart from the hooks for the reason `shares` and `record` do — a
 * function taking its inputs as arguments is one the test runner can call, where
 * the same logic inside a `useEffect` is only reachable through a renderer. The
 * imports are relative and carry a `.ts` extension for the same reason, and
 * nothing here holds cache policy — how long an answer stays fresh is
 * `query-config`, and where it is filed is `query-keys`.
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

/**
 * Mark the reads that follow a manager's leagues as stale.
 *
 * Called when — and only when — a stream result carries a new revision, so a
 * refresh that changed nothing costs nothing. It addresses the ADP valuation by
 * its prefix, so every steepness already in the cache goes with it; a curve is
 * not re-derivable from a stale roster just because nobody has touched the
 * slider.
 */
export function invalidateManagerDependents(
  queryClient: QueryClient,
  searched: string,
  season?: string,
): void {
  for (const queryKey of dependentManagerQueryKeys(searched, season)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
