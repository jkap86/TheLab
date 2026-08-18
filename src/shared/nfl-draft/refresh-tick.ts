// The sync arrives as an argument and the type-only import is erased, so this
// module has no runtime imports at all — the scheduler's decisions are tested
// under Node's runner without `pg` behind them.
import type { NflDraftSyncSummary } from "./sync.ts";

/** The sync as this tick calls it — {@link syncNflDraftPicks}'s shape. */
export type NflDraftSync = (options?: {
  force?: boolean;
}) => Promise<NflDraftSyncSummary>;

/** Where a tick narrates itself; `console` in production, a spy in tests. */
export type TickLog = {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error: unknown) => void;
};

/**
 * One scheduled tick: refresh the NFL draft crosswalk **if it is stale**.
 *
 * **A routine tick never forces, and the version that did was papering over a
 * cadence bug with an upstream fetch.** It used to call
 * `syncNflDraftPicks({ force: !firstRun })` — the `ktc` cadence, interval equal
 * to the TTL, forcing so timing jitter couldn't skip a whole cycle — and the
 * advisory lock was offered as the reason horizontal scaling stayed free. It
 * isn't: the lock only serialises ticks that *overlap*, and instances started
 * minutes apart tick minutes apart, so each one in turn took the lock, forced,
 * and pulled the same 2.6MB file. Three dynos meant three fetches every twelve
 * hours of a file that changes twice a year.
 *
 * The fix is the `projections` cadence instead — interval a fraction of the
 * TTL, never forcing — which is what the freshness gate was always for. A tick
 * that finds the table fresh costs one `isFresh` query inside the lock, so the
 * extra ticks are free and the first one after expiry is the one that fetches,
 * whoever wins the lock. `force` survives for explicit recovery ("the stored
 * crosswalk looks wrong, pull it again now"), which is the only thing it should
 * ever have meant.
 *
 * `firstRun` is therefore no longer a parameter: boot and every tick after it
 * ask the same question.
 */
export async function nflDraftRefreshTick(
  sync: NflDraftSync,
  log: TickLog = {
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message, error) => console.error(message, error),
  },
): Promise<void> {
  try {
    const summary = await sync();
    if (summary.locked) {
      log.log("[nfl-draft] Refresh already running elsewhere; skipped.");
    } else if (summary.rejected) {
      // `syncNflDraftPicks` already logged the counts behind the refusal; this
      // is the line that makes it visible in the loop's own narrative.
      log.warn(
        `[nfl-draft] Refresh rejected (${summary.rejected}); ` +
          `${summary.count} stored pick(s) preserved.`,
      );
    } else if (summary.skipped) {
      log.log(
        `[nfl-draft] Picks still fresh; skipped (${summary.count} rows).`,
      );
    } else {
      log.log(
        `[nfl-draft] Stored ${summary.count} pick(s) ` +
          `(${summary.drafted} drafted, ${summary.count - summary.drafted} ` +
          `undrafted)${summary.removed ? `, removed ${summary.removed}` : ""}.`,
      );
    }
  } catch (error) {
    log.error("[nfl-draft] Refresh failed:", error);
  }
}
