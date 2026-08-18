/**
 * When a season's stat lines change — the one signal a reader that caches this
 * corpus can act on.
 *
 * **Why it exists.** The comps caches hold a season's assembled pool for as
 * long as that season is likely to move (`comps/read-cache`), and for a
 * finished season that is a day. A day is the right *clock*, and it is the
 * wrong answer for the one case where something actually changes: an archive
 * week that came back empty and is later re-probed with rows, a payload the
 * completeness gate refused and the next tick accepted, a backfill reaching a
 * season for the first time. Without a signal those land in Postgres and stay
 * invisible for the rest of the TTL.
 *
 * **Why a listener rather than an import.** `shared/comps` reads this module's
 * tables, so `shared/stats` calling into comps directly would be an import
 * cycle and, worse, would put a reader's caching policy inside the sync that
 * writes. The direction stays comps → stats: the writer announces, and whoever
 * is holding something derived from it decides what that means.
 *
 * **What it is not.** It is *in-process*, and deliberately so. Where the sync
 * and the reader share a dyno — the default single-process deployment, and dev
 * — a correction is visible on the next request. Where they do not
 * (`BACKGROUND_JOBS=off` on the web dyno, the sync on a worker), the web
 * process never hears this and the season's TTL is what bounds the staleness.
 * That is the trade this app has already made everywhere else its caches are
 * per process: Postgres is the source of truth, the clocks are shorter than the
 * data's own, and nothing here justifies a bus between dynos. The TTL is the
 * guarantee; this is the improvement on it.
 *
 * Registered on `globalThis` for the reason the pools and limiters are: two
 * copies of this module would be a publisher nobody is listening to, which is a
 * silence rather than an error.
 */

/** Called with the season whose stored stat lines have just changed. */
export type StatsSeasonListener = (season: string) => void;

const LISTENERS_KEY = Symbol.for("thelab.stats.seasonListeners");
const globalScope = globalThis as typeof globalThis & {
  [LISTENERS_KEY]?: Set<StatsSeasonListener>;
};
const listeners: Set<StatsSeasonListener> = (globalScope[LISTENERS_KEY] ??=
  new Set());

/**
 * Hear about every season this process writes stat lines for.
 *
 * Returns an unsubscribe, which tests use and production does not: a listener
 * registered at module load lives as long as the process. The set is keyed by
 * function identity, so registering the same function twice is once — which is
 * what makes a module-load registration safe under dev's module reloading.
 */
export function onStatsSeasonWritten(listener: StatsSeasonListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Announce that `season`'s stored stat lines changed.
 *
 * A listener that throws is logged and skipped rather than allowed to fail the
 * sync: this is a cache invalidation, and the write it follows has already
 * committed. Failing the tick over it would turn a stale cache into a lost
 * week.
 */
export function notifyStatsSeasonWritten(season: string): void {
  for (const listener of listeners) {
    try {
      listener(season);
    } catch (error) {
      console.warn(
        `[stats] A season-written listener threw for ${season}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/** For tests: forget every listener registered so far. */
export function resetStatsSeasonListeners(): void {
  listeners.clear();
}
