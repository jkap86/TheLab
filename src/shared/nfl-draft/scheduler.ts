import { backgroundJobSwitch, startBackgroundLoop } from "@/shared/util";
import type { BackgroundLoopHandle } from "@/shared/util";

import { nflDraftRefreshTick } from "./refresh-tick";
import { NFL_DRAFT_TTL_MS, syncNflDraftPicks } from "./sync";

/**
 * Interval a *fraction* of the freshness TTL, never forcing — the `projections`
 * cadence, and the reason it replaced the `ktc` one here is argued in
 * {@link nflDraftRefreshTick}: an interval equal to the TTL only works if every
 * tick forces, and a forcing tick per instance is a fetch per instance however
 * well the advisory lock serialises them.
 *
 * A quarter of the TTL, so the table is refreshed within three hours of going
 * stale however the ticks land, and a tick that finds it fresh costs one
 * `isFresh` query inside the lock rather than the whole 2.6MB file.
 */
const NFL_DRAFT_REFRESH_MS = NFL_DRAFT_TTL_MS / 4;

/**
 * Start the in-process NFL draft crosswalk loop — see {@link startBackgroundLoop}
 * for the lifecycle guarantees (Node-only, idempotent, non-overlapping, never
 * killed by a throwing tick).
 *
 * Runs per server instance. `syncNflDraftPicks` takes a Postgres advisory lock
 * with the freshness gate *inside* it, and no scheduled tick forces, so extra
 * instances cost a skipped tick each rather than a duplicate fetch — whichever
 * of them first finds the table stale is the only one that pulls the file.
 *
 * `NFL_DRAFT_SYNC=off` disables it, and `BACKGROUND_JOBS=off` disables every
 * loop — see {@link backgroundJobSwitch}. Which *process* runs it is
 * `BACKGROUND_JOBS=worker` and `shared/jobs/mode`, one layer up.
 */
export function startNflDraftScheduler(): BackgroundLoopHandle {
  return startBackgroundLoop({
    name: "nfl-draft",
    intervalMs: NFL_DRAFT_REFRESH_MS,
    guardKey: "nfl-draft-scheduler",
    ...backgroundJobSwitch("nflDraft"),
    cadence: "check every 3 h, refresh when past 12 h",
    tick: () => nflDraftRefreshTick(syncNflDraftPicks),
  });
}
