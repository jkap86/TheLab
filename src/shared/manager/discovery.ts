/**
 * Which leagues a discovery tick fetches, and which managers it may stamp.
 *
 * Pure and tested, split out of `crawl.ts` because the invariant it carries is
 * easy to state and was quietly wrong: **a manager is stamped only once every
 * new league attributable to them is stored**. Stamping suppresses that manager
 * for `CRAWL_MANAGER_TTL_MS` (six hours), so a manager stamped alongside a
 * league that failed to sync takes the failure with them — the league stays
 * unknown, nothing else references it, and it is only rediscovered when some
 * *other* member of it comes up in the queue.
 *
 * Cross-module types arrive as `import type` (erased), so this stays runtime-free
 * and testable — the same bar `adp-value.ts` and `graph-weeks.ts` are held to,
 * and the reason Node's own runner can drive the invariant above without a
 * database or a fetch.
 */
import type { SleeperLeague } from "@/shared/sleeper";

export type DiscoverySelection = {
  /** The leagues to fetch and persist this tick, deduplicated. */
  leagues: SleeperLeague[];
  /**
   * Manager → every unknown league id attributable to them that made this tick's
   * selection. A league two managers both belong to appears in **both** sets:
   * the fetch is deduplicated, the attribution is not, so a shared league that
   * fails unstamps everyone who was waiting on it.
   */
  selectedByManager: Map<string, Set<string>>;
  /**
   * Managers whose enumeration succeeded *and* whose whole unknown set fits this
   * tick — the only ones eligible to be stamped, and still only if their leagues
   * then sync. A manager with no unknown leagues at all is eligible: there is
   * nothing left to fail.
   */
  eligible: string[];
  /**
   * Managers left for the next tick because the cap filled first. Retryable by
   * construction: unstamped, so they come straight back to the front of the
   * queue.
   */
  deferred: string[];
};

/**
 * Pick this tick's discovery work in queue order.
 *
 * A manager is taken whole or not at all: if their unknown leagues don't fit in
 * what's left of the cap, we take a capful (so a manager with more unknown
 * leagues than the cap still converges, a capful per tick, rather than
 * deadlocking the queue) and stop — but they are *deferred*, not eligible, so
 * next tick sees them again with the stored ones dropped out of `unknown`.
 *
 * `byManager` maps a manager to their enumerated leagues. A manager absent from
 * it is one whose enumeration request failed: they are neither eligible nor
 * deferred, they are simply left unstamped so the queue returns to them.
 */
export function selectDiscoveryLeagues(
  userIds: readonly string[],
  byManager: ReadonlyMap<string, SleeperLeague[]>,
  known: ReadonlySet<string>,
  cap: number,
): DiscoverySelection {
  const fetch = new Map<string, SleeperLeague>();
  const selectedByManager = new Map<string, Set<string>>();
  const eligible: string[] = [];
  const deferred: string[] = [];

  let capped = false;

  for (const userId of userIds) {
    const leagues = byManager.get(userId);
    if (!leagues) continue; // enumeration failed — unstamped, retried later

    if (capped) {
      deferred.push(userId);
      continue;
    }

    // Unknown to the database, judged per manager rather than against what is
    // already queued: a league another manager put in the fetch list is still
    // this manager's dependency, and dropping it here is what let a shared
    // league's failure stamp everyone but the first owner.
    const unknown = leagues
      .map((l) => l.league_id)
      .filter((id) => !known.has(id));
    const unique = new Set(unknown);
    const toAdd = [...unique].filter((id) => !fetch.has(id));

    if (fetch.size + toAdd.length > Math.max(0, cap)) {
      for (const id of toAdd.slice(0, Math.max(0, cap) - fetch.size)) {
        const league = leagues.find((l) => l.league_id === id);
        if (league) fetch.set(id, league);
      }
      deferred.push(userId);
      capped = true;
      continue;
    }

    for (const id of toAdd) {
      const league = leagues.find((l) => l.league_id === id);
      if (league) fetch.set(id, league);
    }
    selectedByManager.set(userId, unique);
    eligible.push(userId);
  }

  return { leagues: [...fetch.values()], selectedByManager, eligible, deferred };
}

/**
 * The managers a tick may stamp: eligible ones none of whose selected leagues
 * failed to sync.
 *
 * Explicitly an intersection against the *ids* that failed rather than a count
 * comparison — with leagues shared between managers, "as many loaded as
 * selected" is true of the wrong managers as often as the right ones.
 */
export function stampableManagers(
  selection: Pick<DiscoverySelection, "eligible" | "selectedByManager">,
  failedLeagueIds: ReadonlySet<string>,
): string[] {
  if (failedLeagueIds.size === 0) return [...selection.eligible];
  return selection.eligible.filter((userId) => {
    const selected = selection.selectedByManager.get(userId);
    if (!selected) return true; // nothing was attributable to them
    for (const id of selected) if (failedLeagueIds.has(id)) return false;
    return true;
  });
}

/**
 * Of the leagues that failed to sync, the ones this tick could not record
 * anywhere — and therefore the only ones still fit to hold a manager back.
 *
 * **This is the bound on {@link stampableManagers}, and the reason that hold is
 * finite.** The hold itself is right: a manager stamped alongside a league that
 * failed takes the failure with them for the enumeration TTL, so the league is
 * forgotten until some other member of it happens to come up. What it lacked was
 * an end. A league that fails *every* time — deleted, or alive but unsyncable —
 * held its managers unstamped forever, and unstamped managers sort to the front
 * of `pendingManagers`: the same managers returned to the head of the queue on
 * every tick, the same leagues were re-fetched, and discovery stopped finding
 * anything for anyone while the corpus stood still. That is not a slow queue,
 * it is a stopped one, and it is invisible in the summary line — which goes on
 * reporting a healthy refresh pass beside `discovered 0`.
 *
 * So the hold is no longer released by a league *succeeding*; it is released by
 * the league being **written down**, which a tombstone and a parked row both do.
 * The distinction that matters to a manager is not whether we have the graph but
 * whether anything still points at the league — a row means discovery can stop
 * carrying it, because the refresh pass has it from here.
 *
 * `recorded` is therefore the ids a row was actually written for, never the ids
 * we merely *meant* to write: passing the intent would stamp a manager on the
 * strength of a write that may not have happened, which is the one way to lose a
 * league permanently. What is left over is the residual this returns — a failure
 * with no payload to write a row from — and it still blocks, exactly as before.
 */
export function unrecordedFailures(
  failedIds: readonly string[],
  recorded: ReadonlySet<string>,
): Set<string> {
  return new Set(failedIds.filter((id) => !recorded.has(id)));
}

/**
 * Leagues still past the freshness TTL after a refresh pass.
 *
 * Both a successful refresh and a tombstone leave the queue: `markLeaguesGone`
 * removes a deleted league from every future claim, so counting only the
 * refreshed ones reported a backlog that included leagues nothing will ever
 * claim again — and that number is what the scheduler's missed-target warning
 * reads. Failures are deliberately *not* subtracted: they are still due, which
 * is the whole point of reporting a remainder.
 */
export function remainingDue(
  dueBefore: number,
  refreshed: number,
  gone: number,
): number {
  return Math.max(dueBefore - refreshed - gone, 0);
}
