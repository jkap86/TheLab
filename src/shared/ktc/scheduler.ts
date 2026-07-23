import { syncKtcHistory } from "./history";
import { KTC_TTL_MS, syncKtcValues } from "./sync";

/** Refresh cadence for KTC values (kept equal to the freshness TTL). */
const KTC_REFRESH_MS = KTC_TTL_MS;

const globalForScheduler = globalThis as unknown as {
  ktcSchedulerStarted?: boolean;
};

async function runOnce(force: boolean): Promise<void> {
  try {
    const summary = await syncKtcValues({ force });
    if (summary.skipped) {
      console.log(`[ktc] Values still fresh; skipped (${summary.count} rows).`);
    } else {
      console.log(`[ktc] Refreshed ${summary.count} values.`);
    }
  } catch (error) {
    // Never let a scrape/DB failure kill the interval — log and retry next tick.
    console.error("[ktc] Refresh failed:", error);
  }

  // Then chip away at the history backfill. Runs after the values sync (which
  // creates the `ktc_values` rows this walks) and is separately guarded so a
  // failure here can't take the values refresh down with it.
  try {
    const { scraped, failed, rows, remaining } = await syncKtcHistory();
    if (scraped || failed) {
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
 * Start the in-process KTC refresh loop. Idempotent: guarded on globalThis so
 * Next.js dev/HMR reloads and repeated instrumentation runs don't stack timers.
 *
 * Runs an initial (non-forced) refresh shortly after boot to populate an empty
 * or stale cache without blocking server startup, then forces a refresh every
 * 15 minutes. Each tick also scrapes a few players' full value history (see
 * `syncKtcHistory`). The timer is `unref`'d so it never keeps the process alive
 * on its own.
 *
 * Runs per server instance. If you scale horizontally the 15-min freshness gate
 * makes extra instances mostly no-op, but a single leader (or a Postgres
 * advisory lock in `syncKtcValues`) would avoid the redundant scrapes entirely.
 */
export function startKtcScheduler(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalForScheduler.ktcSchedulerStarted) return;
  globalForScheduler.ktcSchedulerStarted = true;

  // Kick off the first refresh without blocking boot.
  void runOnce(false);

  const timer = setInterval(() => void runOnce(true), KTC_REFRESH_MS);
  // `unref` exists on Node's Timeout so the loop never holds the process open;
  // cast guards the DOM `setInterval` typing (returns `number`) that tsconfig's
  // `lib: ["dom"]` can pull in.
  (timer as { unref?: () => void }).unref?.();

  console.log("[ktc] Scheduler started (refresh every 15 min).");
}
