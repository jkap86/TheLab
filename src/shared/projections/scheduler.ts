import { backgroundJobSwitch, startBackgroundLoop } from "@/shared/util";

import { syncProjections } from "./sync";

/**
 * How often the loop checks whether any week is stale.
 *
 * Shorter than `PROJECTIONS_TTL_MS` on purpose, and unlike the KTC loop this one
 * never forces: ticking at a fraction of the TTL means timing jitter can't skip a
 * refresh cycle, and the per-week freshness gates decide what actually gets
 * fetched. Most ticks find nothing due and cost two cheap queries — which matters
 * because the alternative is re-downloading 5.6MB per week per tick all offseason.
 *
 * It also sets the pace of the horizon backfill: at `HORIZON_WEEKS_PER_TICK`, this
 * interval walks the whole rest of the season in about two hours, comfortably
 * inside its day-long TTL.
 */
export const PROJECTIONS_INTERVAL_MS = 15 * 60 * 1000;

async function tick(): Promise<void> {
  const { locked, season, synced, deferred, empty, failed, rejected } =
    await syncProjections();
  if (locked) return;

  // Silent when everything was fresh — the common case, every 15 minutes.
  if (
    synced.length === 0 &&
    empty.length === 0 &&
    failed.length === 0 &&
    rejected.length === 0
  ) {
    return;
  }

  const parts = synced.map(
    ({ week, rows, removed }) =>
      `wk${week}: ${rows} row(s)${removed ? `, ${removed} removed` : ""}`,
  );
  if (empty.length) parts.push(`no projections yet for wk${empty.join(", wk")}`);
  if (failed.length) parts.push(`failed wk${failed.join(", wk")}`);
  // The reason is already logged in full by the sync; naming the weeks here
  // keeps a refusal from reading as a quiet tick.
  if (rejected.length) {
    parts.push(`rejected wk${rejected.map((r) => r.week).join(", wk")}`);
  }
  // Says how much backfill is left, so a horizon that stops advancing is visible
  // in the log rather than only in the data.
  if (deferred.length) parts.push(`${deferred.length} horizon week(s) still due`);

  console.log(`[proj] ${season} — ${parts.join("; ")}.`);
}

/**
 * Start the in-process weekly projections loop — see {@link startBackgroundLoop}
 * for the lifecycle guarantees (Node-only, idempotent, non-overlapping, and never
 * killed by a throwing tick).
 *
 * Keeps the current and next NFL week fresh by the hour, and the rest of the
 * season fresh by the day. `syncProjections` takes a Postgres advisory lock, so
 * running several app instances against one database doesn't multiply the load on
 * Sleeper.
 *
 * Set `PROJECTIONS_SYNC=off` to disable (worth doing on a dev server — each week
 * it refreshes is a ~5.6MB download), or `BACKGROUND_JOBS=off` to disable every
 * loop at once — see {@link backgroundJobSwitch} for the web/worker split.
 */
export function startProjectionsScheduler(): void {
  startBackgroundLoop({
    name: "proj",
    intervalMs: PROJECTIONS_INTERVAL_MS,
    guardKey: "projections-scheduler",
    ...backgroundJobSwitch("projections"),
    cadence: "check every 15 min; this week hourly, rest of season daily",
    tick,
  });
}
