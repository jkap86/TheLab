import { backgroundJobSwitch, startBackgroundLoop } from "@/shared/util";

import { NFL_DRAFT_TTL_MS, syncNflDraftPicks } from "./sync";

/** Interval equal to the freshness TTL — the `ktc` cadence, for its reason. */
const NFL_DRAFT_REFRESH_MS = NFL_DRAFT_TTL_MS;

/**
 * One tick: refresh the NFL draft crosswalk.
 *
 * `firstRun` is the boot tick and doesn't force, so a restart respects a table
 * that is still fresh. Scheduled ticks force, because the interval equals the
 * TTL and timing jitter would otherwise skip a whole cycle — the cadence rule
 * for a cache replaced as a whole, which this table is. (The per-slice
 * alternative belongs to `projections`, where a tick that finds nothing due
 * costs one query; here it would cost the whole 2.6MB file.)
 */
async function tick(firstRun: boolean): Promise<void> {
  try {
    const summary = await syncNflDraftPicks({ force: !firstRun });
    if (summary.locked) {
      console.log("[nfl-draft] Refresh already running elsewhere; skipped.");
    } else if (summary.rejected) {
      // `syncNflDraftPicks` already logged the counts behind the refusal; this
      // is the line that makes it visible in the loop's own narrative.
      console.warn(
        `[nfl-draft] Refresh rejected (${summary.rejected}); ` +
          `${summary.count} stored pick(s) preserved.`,
      );
    } else if (summary.skipped) {
      console.log(
        `[nfl-draft] Picks still fresh; skipped (${summary.count} rows).`,
      );
    } else {
      console.log(
        `[nfl-draft] Stored ${summary.count} pick(s) ` +
          `(${summary.drafted} drafted, ${summary.count - summary.drafted} ` +
          `undrafted)${summary.removed ? `, removed ${summary.removed}` : ""}.`,
      );
    }
  } catch (error) {
    console.error("[nfl-draft] Refresh failed:", error);
  }
}

/**
 * Start the in-process NFL draft crosswalk loop — see {@link startBackgroundLoop}
 * for the lifecycle guarantees (Node-only, idempotent, non-overlapping, never
 * killed by a throwing tick).
 *
 * Runs per server instance, but `syncNflDraftPicks` takes a Postgres advisory
 * lock, so scaling horizontally doesn't multiply the fetches — extra instances
 * find the lock held and skip that tick.
 *
 * `NFL_DRAFT_SYNC=off` disables it, and `BACKGROUND_JOBS=off` disables every
 * loop — see {@link backgroundJobSwitch}.
 */
export function startNflDraftScheduler(): void {
  startBackgroundLoop({
    name: "nfl-draft",
    intervalMs: NFL_DRAFT_REFRESH_MS,
    guardKey: "nfl-draft-scheduler",
    ...backgroundJobSwitch("nflDraft"),
    cadence: "refresh every 12 h",
    tick,
  });
}
