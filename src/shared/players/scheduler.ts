import { errorMessage, loopSwitch, startBackgroundLoop } from "@/shared/util";
import type { BackgroundLoopHandle } from "@/shared/util";

import { PLAYERS_TTL_MS, syncPlayers } from "./sync";

/**
 * The players background loop: Sleeper's whole NFL map, once a day.
 *
 * Started from `instrumentation.ts` after migrations and *not awaited* there —
 * a ~5MB download queued behind the Sleeper limiter must not gate request
 * serving, and every page that needs a name degrades to the id in the meantime.
 *
 * **This used to hand-roll its own timer, and the note here argued it should:
 * "two loops with different clocks and different failure stories are two loops,
 * and the shared part is four lines of timer bookkeeping."** That was true of
 * this loop and KTC's, and it stopped being true when the league crawler
 * arrived. A daily tick and a 15-minute one cannot outrun their own intervals;
 * a 60-second tick over a Sleeper fan-out can, so {@link startBackgroundLoop}
 * carries a re-entry guard — behaviour, not bookkeeping. A guard living in one
 * loop of three is the one that gets forgotten in the fourth, so all three
 * share it now. The clocks and the failure stories are still each loop's own,
 * which is what everything below this line still is.
 */

/** Set to `off` (case-insensitive) to disable the loop. */
export const PLAYERS_SYNC_VAR = "PLAYERS_SYNC";

/**
 * Start the loop, idempotently — see {@link startBackgroundLoop} for the
 * lifecycle guarantees (Node-only, idempotent, non-overlapping, and never
 * killed by a throwing tick).
 *
 * **The boot tick does not force and the interval ticks do**, which is the KTC
 * argument exactly: a restart should respect rows that are still fresh — half a
 * dozen deploys in an afternoon must not mean half a dozen downloads of the
 * same 5MB — while an interval tick fires precisely when the TTL has elapsed,
 * so an unforced one would find the rows a moment short of stale and skip every
 * time. That is also why the interval *is* the TTL.
 */
export function startPlayersScheduler(): BackgroundLoopHandle {
  return startBackgroundLoop({
    name: "players",
    intervalMs: PLAYERS_TTL_MS,
    guardKey: "players-sync",
    ...loopSwitch(PLAYERS_SYNC_VAR),
    cadence: "daily",
    tick: (firstRun) => tick(!firstRun),
  });
}

async function tick(force: boolean): Promise<void> {
  try {
    const { locked, skipped, count } = await syncPlayers({ force });
    if (locked) {
      console.log("[players] Refresh running elsewhere; stood down.");
    } else if (skipped) {
      console.log(`[players] Fresh (${count} stored), skipped.`);
    } else {
      console.log(`[players] Stored ${count} players.`);
    }
  } catch (error) {
    // Logged, never thrown: the map going stale costs names on a card, and a
    // failed download must not take the process with it.
    console.error("[players] Refresh failed:", errorMessage(error));
  }
}
