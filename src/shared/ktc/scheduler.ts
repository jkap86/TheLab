import { errorMessage, loopSwitch, startBackgroundLoop } from "@/shared/util";
import type { BackgroundLoopHandle } from "@/shared/util";

import { syncKtcHistory } from "./history";
import { KTC_TTL_MS, syncKtcValues } from "./sync";
import type { KtcSyncSummary } from "./sync";

/**
 * The KTC background loop: current values every 15 minutes, the history
 * backfill once at boot. Started from `instrumentation.ts` after migrations —
 * and *not awaited* there, since the backfill can run half an hour and
 * `register()` gates request serving.
 *
 * Built on {@link startBackgroundLoop} with the players map and the league
 * crawl; `players/scheduler.ts` carries the note on why the three share a loop
 * helper now when two of them deliberately did not.
 */

/** Set to `off` (case-insensitive) to disable the loop — TheLabX's switch. */
export const KTC_SYNC_VAR = "KTC_SYNC";

/**
 * Start the loop, idempotently. The boot tick does not force — a restart
 * should respect a cache that is still fresh — and then drains the history
 * queue to completion, once; a player who joins a board mid-process gets
 * forward snapshots only until the next boot (see `./history`). Interval ticks
 * force and sync values only, and the interval *is* the TTL, so an unforced one
 * would find the board a moment short of stale and skip forever.
 */
export function startKtcScheduler(): BackgroundLoopHandle {
  return startBackgroundLoop({
    name: "ktc",
    intervalMs: KTC_TTL_MS,
    guardKey: "ktc-sync",
    ...loopSwitch(KTC_SYNC_VAR),
    cadence: "every 15m; history backfilled once at boot",
    tick: async (firstRun) => {
      if (firstRun) return bootTick();
      await valuesTick(true);
    },
  });
}

async function valuesTick(force: boolean): Promise<KtcSyncSummary | null> {
  try {
    const summary = await syncKtcValues({ force });
    for (const board of summary.boards) {
      if (board.failed) continue; // already logged by the sync
      if (board.skipped && board.rejected === null) {
        console.log(`[ktc] ${board.format}: fresh (${board.count} priced), skipped`);
      } else if (!board.skipped) {
        console.log(`[ktc] ${board.format}: stored ${board.count} values`);
      }
    }
    return summary;
  } catch (error) {
    console.error("[ktc] Values refresh failed:", errorMessage(error));
    return null;
  }
}

async function bootTick(): Promise<void> {
  await valuesTick(false);
  try {
    const { locked, scraped, failed, rows, remaining } = await syncKtcHistory();
    if (locked) {
      console.log("[ktc] History backfill running elsewhere; stood down.");
    } else if (scraped + failed === 0 && remaining === 0) {
      console.log("[ktc] History complete; nothing to backfill.");
    } else {
      console.log(
        `[ktc] History backfill: scraped ${scraped}, failed ${failed}, ` +
          `${rows} day rows, ${remaining} remaining.`,
      );
    }
  } catch (error) {
    console.error("[ktc] History backfill failed:", errorMessage(error));
  }
}
