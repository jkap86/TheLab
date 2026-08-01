import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

/**
 * Everything the client cache drops half an hour after the last component stops
 * reading it.
 *
 * Long enough that a trip out to another tool and back is a hit, short enough
 * that a tab left open overnight isn't still holding a hundred leagues' worth of
 * rosters. It is a *retention* bound and not a freshness one: an entry inside it
 * still refetches once its own stale time has passed, and those are set per
 * query (`features/manager/query-config`) rather than globally, because the
 * resources move at genuinely different speeds — the same rule the background
 * loops follow.
 */
export const GC_TIME = 30 * 60 * 1000;

/**
 * The one query client the app shares, and the only browser-side cache of these
 * routes.
 *
 * It lives in `features/shared` because the provider that mounts it is the app's
 * root layout: the manager tabs are what needed it, but a client created inside
 * the manager subtree would be re-created on the way out to another tool and
 * back, which is most of what it exists to prevent.
 *
 * `refetchOnWindowFocus` is off — none of these reads is live enough to be worth
 * re-asking for on every alt-tab, and the per-query stale times are the schedule
 * instead. `refetchOnReconnect` stays on, since a dropped connection is exactly
 * when the screen is likely to be behind. One retry: a route that failed for a
 * real reason (an unknown username, a database that is down) fails the same way
 * twice, so retrying past that only makes the error take longer to appear.
 *
 * `overrides` is for the tests, which want retries off and a controlled
 * `gcTime`; the app takes the defaults.
 */
export function createQueryClient(overrides?: QueryClientConfig): QueryClient {
  return new QueryClient({
    ...overrides,
    defaultOptions: {
      ...overrides?.defaultOptions,
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
        gcTime: GC_TIME,
        ...overrides?.defaultOptions?.queries,
      },
    },
  });
}
