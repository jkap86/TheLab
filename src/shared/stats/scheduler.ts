import { startBackgroundLoop } from "@/shared/util";

import { syncStats } from "./sync";

/**
 * How often the loop checks whether any week is stale.
 *
 * Shorter than {@link STATS_TTL_MS} on purpose and, like the projections loop
 * and unlike the KTC one, it never forces: ticking at a fraction of the TTL
 * means timing jitter can't skip a refresh cycle, and the per-week freshness
 * gates decide what actually gets fetched. Most ticks find nothing due and cost
 * one cheap query — which matters, because the alternative is re-downloading
 * several megabytes a week per tick all offseason for a season whose numbers
 * stopped moving in January.
 *
 * It also sets the pace of the two-season backfill: at
 * {@link SETTLED_WEEKS_PER_TICK}, this interval walks ~36 weeks in about five
 * hours, comfortably inside their month-long TTL.
 */
export const STATS_INTERVAL_MS = 15 * 60 * 1000;

async function tick(): Promise<void> {
  const { locked, season, synced, deferred, empty, failed, rejected } =
    await syncStats();
  if (locked) return;

  // Silent when everything was fresh — the common case, every 15 minutes, and
  // the *only* case all offseason once the backfill has settled.
  if (
    synced.length === 0 &&
    empty.length === 0 &&
    failed.length === 0 &&
    rejected.length === 0
  ) {
    return;
  }

  const label = (t: { season: string; week: number }) =>
    t.season === season ? `wk${t.week}` : `${t.season} wk${t.week}`;

  const parts = synced.map(
    (result) =>
      `${label(result)}: ${result.rows} row(s)` +
      (result.removed ? `, ${result.removed} removed` : ""),
  );
  if (empty.length) parts.push(`not played yet: ${empty.map(label).join(", ")}`);
  if (failed.length) parts.push(`failed ${failed.map(label).join(", ")}`);
  // The reason is already logged in full by the sync; naming the weeks here
  // keeps a refusal from reading as a quiet tick.
  if (rejected.length) {
    parts.push(`rejected ${rejected.map(label).join(", ")}`);
  }
  // Says how much backfill is left, so a season that stops advancing is visible
  // in the log rather than only in the data.
  if (deferred.length) parts.push(`${deferred.length} settled week(s) still due`);

  console.log(`[stats] ${season} — ${parts.join("; ")}.`);
}

/**
 * Start the in-process weekly stats loop — see {@link startBackgroundLoop} for
 * the lifecycle guarantees (Node-only, idempotent, non-overlapping, and never
 * killed by a throwing tick).
 *
 * Keeps the week being played and the one still being corrected fresh by the
 * hour, and every settled week of this season and the last one fresh by the
 * month. `syncStats` takes a Postgres advisory lock, so running several app
 * instances against one database doesn't multiply the load on Sleeper.
 *
 * Set `STATS_SYNC=off` to disable (worth doing on a dev server — each week it
 * refreshes is a multi-megabyte download).
 */
export function startStatsScheduler(): void {
  startBackgroundLoop({
    name: "stats",
    intervalMs: STATS_INTERVAL_MS,
    guardKey: "stats-scheduler",
    enabled: process.env.STATS_SYNC !== "off",
    disabledReason: "STATS_SYNC=off",
    cadence: "check every 15 min; live weeks hourly, settled weeks monthly",
    tick,
  });
}
