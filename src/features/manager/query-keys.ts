/**
 * The query keys every manager read is cached under, re-exported from where they
 * live now.
 *
 * They moved to `features/shared/manager-query.ts` when the lineup checker began
 * drawing this tool's subject rail and both of its shares sheets: those reads are
 * `/api/user/[username]/{players,leaguemates}` under exactly these keys, and a
 * key built inside a feature that a shared component has to call is a key that
 * feature can no longer own. Nothing about their shape changed. This file stays
 * because this module's own consumers — the hooks, `query-fns`, and the tests
 * that hash these keys — already import them from here.
 *
 * Relative with an explicit `.ts` extension, the rule every import that may end
 * up under the test runner keeps.
 */
export {
  dependentManagerQueryKeys,
  managerQueryKeys,
} from "../shared/manager-query.ts";

// The board's own query key moved to `features/shared` once the trades page
// started reading the same board — it was never manager-scoped to begin with
// (see `boardQueryKeys`'s own note), so a second feature reading it is the
// mover's rule applying to a key rather than a component.
export {
  boardQueryKeys,
  normalizeAdpQuery,
  type NormalizedAdpQuery,
} from "../shared/adp-query.ts";

// `/api/league/[leagueId]`'s key went to `features/shared/league-query.ts` with
// the panel that reads it — the trades board opens a trade card into the same
// standings and rosters. It was never manager-scoped in the first place (that
// route answers about a league and asks about no account), so nothing about its
// shape changed.
export { leagueQueryKeys } from "../shared/league-query.ts";

// `/api/kickoff`'s key went to `features/shared/schedule-query.ts` with the
// header that reads it — the lineup checker wears the same plate. The instant is
// a fact about a season, so it was never manager-scoped either.
export { scheduleQueryKeys } from "../shared/schedule-query.ts";
