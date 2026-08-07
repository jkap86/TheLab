/**
 * How long each of the manager area's answers is worth reusing, re-exported from
 * where the table lives now.
 *
 * It went to `features/shared/manager-query.ts` with the keys it is indexed
 * alongside, because the lineup checker reads two of these entries under the same
 * keys — see that module's own note on why the whole table travelled rather than
 * the two rows. This file stays for this feature's own hooks, which already
 * import `STALE_TIMES` from here.
 */
export { MANAGER_STALE_TIMES as STALE_TIMES } from "../shared/manager-query.ts";
