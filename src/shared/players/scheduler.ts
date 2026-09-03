import { errorMessage } from "@/shared/util";

import { PLAYERS_TTL_MS, syncPlayers } from "./sync";

/**
 * The players background loop: Sleeper's whole NFL map, once a day.
 *
 * Started from `instrumentation.ts` after migrations and *not awaited* there —
 * a ~5MB download queued behind the Sleeper limiter must not gate request
 * serving, and every page that needs a name degrades to the id in the meantime.
 *
 * Built on the KTC scheduler's shape rather than sharing code with it: two
 * loops with different clocks and different failure stories are two loops, and
 * the shared part is four lines of timer bookkeeping.
 */

/** Set to `off` (case-insensitive) to disable the loop. */
export const PLAYERS_SYNC_VAR = "PLAYERS_SYNC";

/**
 * Cached on `globalThis` for the reason the Sleeper limiter and the pg pool
 * are: dev's module reloading would otherwise stack a loop per edit, and every
 * copy would download the map on its own clock.
 */
const SCHEDULER_KEY = Symbol.for("thelab.players.scheduler");
const globalScope = globalThis as typeof globalThis & {
  [SCHEDULER_KEY]?: NodeJS.Timeout;
};

/**
 * Start the loop, idempotently.
 *
 * **The boot tick does not force and the interval ticks do**, which is the KTC
 * argument exactly: a restart should respect rows that are still fresh — half a
 * dozen deploys in an afternoon must not mean half a dozen downloads of the
 * same 5MB — while an interval tick fires precisely when the TTL has elapsed,
 * so an unforced one would find the rows a moment short of stale and skip every
 * time.
 *
 * The timer is `unref()`d so a process with nothing else to do (a build, a
 * script importing this transitively) can exit.
 */
export function startPlayersScheduler(): void {
  if (process.env[PLAYERS_SYNC_VAR]?.trim().toLowerCase() === "off") {
    return;
  }
  if (globalScope[SCHEDULER_KEY]) return;

  const timer = setInterval(() => {
    void tick(true);
  }, PLAYERS_TTL_MS);
  timer.unref();
  globalScope[SCHEDULER_KEY] = timer;

  void tick(false);
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
