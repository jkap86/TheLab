/**
 * The query tests' `fetch` mock and test client, re-exported.
 *
 * It moved to `features/shared` when the trades board's own cache tests became
 * the second reader — the mover's rule, applied to a test helper — and is
 * re-exported here because this feature's tests already import it from this
 * path. One canonical definition under two names, the habit `manager/format`
 * and `adp-controls` keep for the same reason.
 */
export {
  createTestQueryClient,
  flush,
  installFetchMock,
  jsonResponse,
  ndjsonResponse,
  type FetchMock,
} from "../shared/query-test-support.ts";
