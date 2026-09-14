import { LOCK_KEYS, msInterval, pool, withAdvisoryLock } from "@/shared/db";
import {
  BOOT_STAGGER_MS,
  errorMessage,
  loopSwitch,
  startBackgroundLoop,
} from "@/shared/util";
import type { BackgroundLoopHandle } from "@/shared/util";

import {
  PRUNE_VISITOR_LOGS_SQL,
  pruneContinues,
  RETENTION_BATCH,
  RETENTION_INTERVAL_MS,
  RETENTION_MAX_BATCHES_PER_TICK,
  retentionPolicy,
} from "./retention-plan";

/**
 * The visit log's retention loop: rows older than the policy are removed, in
 * bounded batches, every six hours. The decisions are `./retention-plan`'s
 * and are driven under Node's own runner there; this is the wiring — the
 * pool, the lock and the loop.
 *
 * **Under an advisory lock, try/skip, like every other tick.** Two instances
 * against one database would otherwise both delete the same oldest rows,
 * which is harmless and pointless; `withAdvisoryLock` lets one do it and the
 * other stand down. `LOCK_KEYS.visitorLogRetention` is the `[8675309, 4]`
 * `logs/index.ts` reserved for this the day the table landed.
 */

/** `VISITOR_LOG_RETENTION=off` disables the loop; the *days* are another var. */
export const VISITOR_LOG_RETENTION_LOOP_VAR = "VISITOR_LOG_RETENTION";

export type PruneSummary = {
  deleted: number;
  batches: number;
  /** True when the tick stopped on its batch budget with rows still past the cutoff. */
  exhausted: boolean;
};

/** Remove rows older than `retentionMs`, in bounded batches. */
export async function pruneVisitorLogs(
  retentionMs: number,
  {
    batch = RETENTION_BATCH,
    maxBatches = RETENTION_MAX_BATCHES_PER_TICK,
  }: { batch?: number; maxBatches?: number } = {},
): Promise<PruneSummary> {
  let deleted = 0;
  let batches = 0;
  let lastDeleted = batch;
  while (pruneContinues(batches, lastDeleted, batch, maxBatches)) {
    const result = await pool.query(PRUNE_VISITOR_LOGS_SQL, [msInterval(retentionMs), batch]);
    lastDeleted = result.rowCount ?? 0;
    deleted += lastDeleted;
    batches += 1;
  }
  return { deleted, batches, exhausted: lastDeleted >= batch };
}

/** Start the loop, idempotently. */
export function startVisitorLogRetention(): BackgroundLoopHandle {
  const policy = retentionPolicy(process.env);
  if (policy.warning) console.warn(`[logs] ${policy.warning}`);
  const loop = loopSwitch(VISITOR_LOG_RETENTION_LOOP_VAR);
  const enabled = loop.enabled && policy.enabled;
  const disabledReason = loop.disabledReason ?? (policy.enabled ? undefined : policy.reason);

  return startBackgroundLoop({
    name: "logs",
    intervalMs: RETENTION_INTERVAL_MS,
    guardKey: "visitor-log-retention",
    enabled,
    disabledReason,
    cadence: policy.enabled ? `every 6h; keeps ${policy.days} days` : "off",
    initialDelayMs: BOOT_STAGGER_MS.logs,
    tick: async () => {
      if (!policy.enabled) return;
      try {
        const summary = await withAdvisoryLock(LOCK_KEYS.visitorLogRetention, () =>
          pruneVisitorLogs(policy.retentionMs),
        );
        if (summary === null) {
          console.log("[logs] Retention running elsewhere; stood down.");
        } else if (summary.deleted > 0) {
          console.log(
            `[logs] Removed ${summary.deleted} visits older than ${policy.days} days` +
              (summary.exhausted ? " (more remain; next tick continues)." : "."),
          );
        }
      } catch (error) {
        console.error("[logs] Retention failed:", errorMessage(error));
      }
    },
  });
}
