import { errorMessage } from "@/shared/util";

import { syncKtcHistory } from "./history";
import { KTC_TTL_MS, syncKtcValues } from "./sync";
import type { KtcSyncSummary } from "./sync";

/**
 * The KTC background loop: current values every 15 minutes, the history
 * backfill once at boot. Started from `instrumentation.ts` after migrations —
 * and *not awaited* there, since the backfill can run half an hour and
 * `register()` gates request serving.
 */

/** Set to `off` (case-insensitive) to disable the loop — TheLabX's switch. */
export const KTC_SYNC_VAR = "KTC_SYNC";

/**
 * Cached on `globalThis` for the reason the Sleeper limiter and the pg pool
 * are: dev's module reloading would otherwise stack a loop per edit, and every
 * copy would scrape KTC on its own clock.
 */
const SCHEDULER_KEY = Symbol.for("thelab.ktc.scheduler");
const globalScope = globalThis as typeof globalThis & {
  [SCHEDULER_KEY]?: NodeJS.Timeout;
};

/**
 * Start the loop, idempotently. The boot tick does not force — a restart
 * should respect a cache that is still fresh — and then drains the history
 * queue to completion, once; a player who joins a board mid-process gets
 * forward snapshots only until the next boot (see `./history`). Interval ticks
 * force and sync values only.
 *
 * The timer is `unref()`d so a process with nothing else to do (a build, a
 * script importing this transitively) can exit.
 */
export function startKtcScheduler(): void {
  if (process.env[KTC_SYNC_VAR]?.trim().toLowerCase() === "off") {
    return;
  }
  if (globalScope[SCHEDULER_KEY]) return;

  const timer = setInterval(() => {
    void valuesTick(true);
  }, KTC_TTL_MS);
  timer.unref();
  globalScope[SCHEDULER_KEY] = timer;

  void bootTick();
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
