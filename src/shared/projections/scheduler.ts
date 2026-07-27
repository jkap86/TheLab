import { startBackgroundLoop } from "@/shared/util";

import { syncProjections } from "./sync";

/**
 * How often the loop checks whether its target weeks are stale.
 *
 * Shorter than `PROJECTIONS_TTL_MS` on purpose, and unlike the KTC loop this one
 * never forces: ticking at a fraction of the TTL means timing jitter can't skip a
 * refresh cycle, and the per-week freshness gate decides what actually gets
 * fetched. Most ticks find nothing due and cost one cheap query — which matters
 * because the alternative is re-downloading 5.6MB per week per tick all offseason.
 */
export const PROJECTIONS_INTERVAL_MS = 15 * 60 * 1000;

async function tick(): Promise<void> {
  const { locked, season, synced, empty, failed } = await syncProjections();
  if (locked) return;

  // Silent when everything was fresh — the common case, every 15 minutes.
  if (synced.length === 0 && empty.length === 0 && failed.length === 0) return;

  const parts = synced.map(
    ({ week, rows, removed }) =>
      `wk${week}: ${rows} row(s)${removed ? `, ${removed} removed` : ""}`,
  );
  if (empty.length) parts.push(`no projections yet for wk${empty.join(", wk")}`);
  if (failed.length) parts.push(`failed wk${failed.join(", wk")}`);

  console.log(`[proj] ${season} — ${parts.join("; ")}.`);
}

/**
 * Start the in-process weekly projections loop — see {@link startBackgroundLoop}
 * for the lifecycle guarantees (Node-only, idempotent, non-overlapping, and never
 * killed by a throwing tick).
 *
 * Keeps the current and next NFL week fresh. `syncProjections` takes a Postgres
 * advisory lock, so running several app instances against one database doesn't
 * multiply the load on Sleeper.
 *
 * Set `PROJECTIONS_SYNC=off` to disable (worth doing on a dev server — each week
 * it refreshes is a ~5.6MB download).
 */
export function startProjectionsScheduler(): void {
  startBackgroundLoop({
    name: "proj",
    intervalMs: PROJECTIONS_INTERVAL_MS,
    guardKey: "projections-scheduler",
    enabled: process.env.PROJECTIONS_SYNC !== "off",
    disabledReason: "PROJECTIONS_SYNC=off",
    cadence: "check every 15 min, refresh hourly",
    tick,
  });
}
