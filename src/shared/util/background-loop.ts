// A `.ts` extension because this module is reached from its own test under
// Node's runner, which resolves the file it is given — the rule
// `sync-admission.ts` follows to `../sleeper/limiter.ts`.
import { isNodeRuntime } from "./runtime.ts";

type BackgroundLoop = {
  /** Log prefix and identity in start/skip messages, e.g. `"ktc"`. */
  name: string;
  intervalMs: number;
  /**
   * Key on `globalThis` guarding against double-starts across Next.js dev/HMR
   * reloads and repeated instrumentation runs. Must be unique per loop.
   */
  guardKey: string;
  /** Set false to leave the loop unstarted (e.g. an env flag). */
  enabled?: boolean;
  /** Reason logged when `enabled` is false. */
  disabledReason?: string;
  /** Human-readable cadence for the startup log, e.g. `"every 60s"`. */
  cadence: string;
  /**
   * One tick. Runs on start, then every `intervalMs`. `firstRun` is true only
   * for the boot tick — which is what lets a loop respect a cache a scheduled
   * tick would refresh unconditionally. Every loop here uses it that way: see
   * the note on `startKtcScheduler`.
   */
  tick: (firstRun: boolean) => Promise<void>;
};

/**
 * What a start attempt hands back, so a caller can shut the loop down again.
 *
 * Every call returns one, including the calls that started nothing: a handle
 * that says `running: false` and why is what lets a caller report which of its
 * loops are actually ticking, instead of assuming the ones it asked for.
 * `stop` is idempotent and safe on a handle that never started.
 */
export type BackgroundLoopHandle = {
  name: string;
  guardKey: string;
  /** Whether *this* call started the timer. */
  running: boolean;
  /** Why not, when `running` is false: the env switch, or an earlier start. */
  reason?: string;
  stop: () => void;
};

const globalForLoops = globalThis as unknown as {
  backgroundLoops?: Set<string>;
};

const started = (globalForLoops.backgroundLoops ??= new Set<string>());

/**
 * Start an in-process background loop.
 *
 * Shared by the KeepTradeCut refresh, the players map and the league crawl,
 * which need the same four things:
 *
 *   - **Node-only.** Skipped on Next's Edge runtime, since these touch `pg`.
 *     A bare Node process (a test) is Node — see {@link isNodeRuntime}, which
 *     is where that reading is argued.
 *   - **Idempotent.** Guarded on `globalThis` so dev/HMR reloads don't stack
 *     timers, which would silently multiply the load on the upstream API.
 *   - **Non-overlapping.** A tick that outruns the interval is not re-entered;
 *     the next interval is skipped instead of piling on.
 *   - **Unkillable.** A throwing tick is logged, never propagated — one bad
 *     tick must not take the interval down with it.
 *
 * **The first two of those are what the three loops used to spell for
 * themselves, and the last two are why this file exists.** `players/scheduler`
 * argued the duplication was right because "the shared part is four lines of
 * timer bookkeeping", which was true of a 15-minute and a daily loop: neither
 * can outrun its own interval, so neither needed a re-entry guard. The crawler
 * ticks every 60 seconds over a Sleeper fan-out that can take longer than that,
 * so the guard is real behaviour rather than bookkeeping — and a guard present
 * in one loop of three is the one that gets forgotten in the fourth.
 *
 * The timer is `unref`'d, so the loop never holds the process open by itself.
 * That is right for the web server, which is held open by its listening socket,
 * and it is what lets a build or a script that imports this transitively exit.
 * The first tick runs immediately without blocking startup.
 */
export function startBackgroundLoop({
  name,
  intervalMs,
  guardKey,
  enabled = true,
  disabledReason,
  cadence,
  tick,
}: BackgroundLoop): BackgroundLoopHandle {
  const idle = (reason: string): BackgroundLoopHandle => ({
    name,
    guardKey,
    running: false,
    reason,
    stop: () => {},
  });

  if (!isNodeRuntime()) return idle("not the Node.js runtime");

  if (!enabled) {
    console.log(
      `[${name}] Loop disabled${disabledReason ? ` (${disabledReason})` : ""}.`,
    );
    return idle(disabledReason ?? "disabled");
  }

  if (started.has(guardKey)) return idle("already started in this process");
  started.add(guardKey);

  let ticking = false;
  const runTick = async (firstRun: boolean) => {
    if (ticking) return;
    ticking = true;
    try {
      await tick(firstRun);
    } catch (error) {
      console.error(`[${name}] Tick failed:`, error);
    } finally {
      ticking = false;
    }
  };

  void runTick(true);

  const timer = setInterval(() => void runTick(false), intervalMs);
  // `unref` exists on Node's Timeout; the cast guards the DOM `setInterval`
  // typing (returns `number`) that tsconfig's `lib` can pull in.
  (timer as { unref?: () => void }).unref?.();

  console.log(`[${name}] Loop started (${cadence}).`);

  let stopped = false;
  return {
    name,
    guardKey,
    running: true,
    stop: () => {
      // Idempotent, and it releases the guard key: a stop that left the key
      // behind would make the loop unstartable for the life of the process,
      // which turns a clean shutdown into a boot problem for whoever restarts
      // the loops in the same process (the tests do exactly that).
      if (stopped) return;
      stopped = true;
      clearInterval(timer as unknown as NodeJS.Timeout);
      started.delete(guardKey);
      console.log(`[${name}] Loop stopped.`);
    },
  };
}
