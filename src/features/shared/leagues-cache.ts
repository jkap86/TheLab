/**
 * The one place a leagues stream's state is written into the query cache — and
 * therefore the one place that can notice a manager's dependent reads have
 * fallen behind.
 *
 * **It exists because the leagues entry has three writers and the invalidation
 * had one reader.** `/api/user/[username]/leagues` is filed under one key
 * (`managerQueryKeys.leagues`, lower-cased, so the manager tool's URL name and
 * the two tools' stored account name are one entry — see `manager-query.ts`),
 * and the pick tracker, the lineup checker and the manager tabs all refresh it.
 * Deciding "the revision moved, so the dependent reads are stale" inside the
 * manager tool's own hook made that decision a fact about *whether the manager
 * tool happened to be mounted*: a reader who visited the manager tool, walked
 * over to the lineup checker, let that tool refresh the leagues past its stale
 * time, and walked back, arrived to a manager page whose first sighting of the
 * new revision was its *initial* one — so nothing was invalidated and the
 * rosters, membership, ranks, values and ADP valuation on screen were the ones a
 * previous revision produced, for as long as their own stale times allowed (ten
 * minutes for the shares, fifteen for KTC and the valuation).
 *
 * So the comparison moved to the write: whoever publishes a new revision is who
 * invalidates, whatever tool they belong to and whether or not any component is
 * reading the result. The rule is exactly three lines wide:
 *
 * ```
 * nothing cached      → publish, invalidate nothing   (a first population)
 * same revision       → publish, invalidate nothing   (a refresh that changed nothing)
 * a different revision → publish, invalidate the dependents
 * ```
 *
 * **It cannot loop.** {@link dependentManagerQueryKeys} deliberately excludes the
 * leagues entry itself — it is the thing that changed, and it already holds the
 * new data — so an invalidation here can never provoke the refresh that would
 * run this again. The ADP board is excluded for the other reason: it describes
 * the crawled database rather than this manager.
 *
 * Pure apart from the client it is handed: `QueryClient` arrives as an argument
 * and as an erased `import type`, so this module is driven directly by the tests
 * with a relative `.ts` import and nothing behind it.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { ManagerLeaguesData } from "./leagues-stream.ts";
import { dependentManagerQueryKeys, managerQueryKeys } from "./manager-query.ts";

/**
 * The revision the cache already holds for a manager, if it holds anything.
 *
 * The fetcher takes this as `previousRevision` so a re-read *continues* the
 * refresh sequence rather than restarting it — a restart would rewind the
 * counter, which every reader of the entry would then see as a change.
 */
export function cachedLeaguesRevision(
  queryClient: QueryClient,
  searched: string,
  season?: string,
): string | undefined {
  return queryClient.getQueryData<ManagerLeaguesData>(
    managerQueryKeys.leagues(searched, season),
  )?.revision;
}

/**
 * Whether replacing `previous` with `next` leaves the dependent reads behind.
 *
 * **An absent revision on either side is never a change.** A missing one means
 * "no claim", not "a different claim", and there are two ways to get one: an
 * empty cache (the first population, where there is nothing on screen that could
 * be stale) and a published state carrying no payload — the `progress` messages
 * a cold sync sends before it has any leagues to report, whose revision is the
 * empty string by construction. Treating either as a difference would invalidate
 * five reads at the one moment they are least worth re-asking.
 */
export function dependentsFellBehind(
  previous: string | null | undefined,
  next: string | null | undefined,
): boolean {
  if (!previous || !next) return false;
  return previous !== next;
}

/**
 * Mark the reads that follow a manager's leagues as stale.
 *
 * Called when — and only when — a published revision differs from the one the
 * cache held, so a refresh that changed nothing costs nothing. It addresses the
 * ADP valuation by its prefix, so every steepness already in the cache goes with
 * it; a curve is not re-derivable from a stale roster just because nobody has
 * touched the slider.
 *
 * Narrow on purpose: never `invalidateQueries()` with no key, which would take
 * the board, the league detail, the schedule and every other manager's entries
 * with it.
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

/**
 * Write one state of the leagues stream into the cache, invalidating whatever it
 * leaves behind.
 *
 * This is what every reader of the stream passes as `publish` — the manager
 * tool's own hook and {@link userLeaguesQuery} alike — which is what makes the
 * invalidation a property of the *entry* rather than of any tool's lifecycle.
 * The fetcher calls it with every state it reaches, newest last, so the
 * comparison below is against whatever the previous message left in the cache
 * and not against a mount-local memory of one.
 */
export function publishManagerLeagues(
  queryClient: QueryClient,
  searched: string,
  data: ManagerLeaguesData,
  season?: string,
): void {
  const queryKey = managerQueryKeys.leagues(searched, season);
  const previous = queryClient.getQueryData<ManagerLeaguesData>(queryKey)?.revision;
  queryClient.setQueryData(queryKey, data);
  if (dependentsFellBehind(previous, data.revision)) {
    invalidateManagerDependents(queryClient, searched, season);
  }
}
