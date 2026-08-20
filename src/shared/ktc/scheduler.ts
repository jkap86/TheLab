import { backgroundJobSwitch, startBackgroundLoop } from "@/shared/util";
import type { BackgroundLoopHandle } from "@/shared/util";

import { syncKtcHistory } from "./history";
import { KTC_TTL_MS, syncKtcValues } from "./sync";

/** Refresh cadence for KTC values (kept equal to the freshness TTL). */
const KTC_REFRESH_MS = KTC_TTL_MS;

/**
 * Refresh values, then chip away at the history backfill.
 *
 * The two are separately guarded so a failure in the backfill can't take the
 * values refresh down with it, and ordered so the backfill walks `ktc_values`
 * rows the refresh has already created.
 *
 * `firstRun` is the boot tick, which doesn't force: a restart should respect a
 * cache that is still fresh. Scheduled ticks force, because the interval equals
 * the freshness TTL and timing jitter would otherwise skip a whole cycle.
 */
async function tick(firstRun: boolean): Promise<void> {
  try {
    const summary = await syncKtcValues({ force: !firstRun });
    if (summary.locked) {
      console.log("[ktc] Values refresh already running elsewhere; skipped.");
    } else if (summary.rejected) {
      // `syncKtcValues` already logged the counts behind the refusal; this is
      // the line that makes it visible in the loop's own narrative.
      console.warn(
        `[ktc] Values refresh rejected (${summary.rejected}); ` +
          `${summary.count} stored value(s) preserved.`,
      );
    } else if (summary.skipped) {
      console.log(`[ktc] Values still fresh; skipped (${summary.count} rows).`);
    } else {
      console.log(`[ktc] Refreshed ${summary.count} values.`);
    }
  } catch (error) {
    console.error("[ktc] Refresh failed:", error);
  }

  try {
    const { locked, scraped, failed, rows, remaining } = await syncKtcHistory();
    if (!locked && (scraped || failed)) {
      console.log(
        `[ktc] History: scraped ${scraped} player(s), ${rows} day rows` +
          `${failed ? `, ${failed} failed` : ""}; ${remaining} still due.`,
      );
    }
  } catch (error) {
    console.error("[ktc] History backfill failed:", error);
  }
}

/**
 * Start the in-process KeepTradeCut refresh loop — see {@link startBackgroundLoop}
 * for the lifecycle guarantees (Node-only, idempotent, non-overlapping, and
 * never killed by a throwing tick).
 *
 * Runs per server instance, but `syncKtcValues` and `syncKtcHistory` each take a
 * Postgres advisory lock, so scaling horizontally doesn't multiply the scrapes —
 * extra instances find the lock held and skip that tick.
 *
 * `KTC_SYNC=off` disables it, and `BACKGROUND_JOBS=off` disables every loop —
 * see {@link backgroundJobSwitch}. This was the one loop with no switch at all,
 * which made "web dyno serves, worker dyno crawls" impossible to express however
 * the other three were set. Which *process* runs it is `BACKGROUND_JOBS=worker`
 * and `shared/jobs/mode`, one layer above this switch.
 */
export function startKtcScheduler(): BackgroundLoopHandle {
  return startBackgroundLoop({
    name: "ktc",
    intervalMs: KTC_REFRESH_MS,
    guardKey: "ktc-scheduler",
    ...backgroundJobSwitch("ktc"),
    cadence: "refresh every 15 min",
    tick,
  });
}
