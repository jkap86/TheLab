import { isNodeRuntime } from "./runtime";

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
   * for the boot tick — useful when startup should respect a cache that a
   * scheduled tick would refresh unconditionally.
   */
  tick: (firstRun: boolean) => Promise<void>;
};

/**
 * What a start attempt hands back, so a caller can shut the loop down again.
 *
 * Every call returns one, including the calls that started nothing: a handle
 * that says `running: false` and why is what lets the worker report which of
 * its jobs are actually ticking, instead of assuming the five it asked for.
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
 * Shared by the KeepTradeCut refresh and the league crawl, which need the same
 * four things:
 *
 *   - **Node-only.** Skipped on Next's Edge runtime, since these touch `pg`.
 *     A bare Node process (`src/worker.ts`, a test) is Node — see
 *     {@link isNodeRuntime}, which is where that reading is argued.
 *   - **Idempotent.** Guarded on `globalThis` so dev/HMR reloads don't stack
 *     timers, which would silently multiply the load on the upstream API.
 *   - **Non-overlapping.** A tick that outruns the interval is not re-entered;
 *     the next interval is skipped instead of piling on.
 *   - **Unkillable.** A throwing tick is logged, never propagated — one bad
 *     tick must not take the interval down with it.
 *
 * The timer is `unref`'d, so the loop never holds the process open by itself.
 * That is right for the web server, which is held open by its listening socket,
 * and it is why the worker holds its *own* keep-alive rather than relying on
 * these timers (`shared/jobs/run-worker`). The first tick runs immediately
 * without blocking startup.
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
    console.log(`[${name}] Loop disabled${disabledReason ? ` (${disabledReason})` : ""}.`);
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
  // typing (returns `number`) that tsconfig's `lib: ["dom"]` can pull in.
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
      // the jobs in the same process (the tests do exactly that).
      if (stopped) return;
      stopped = true;
      clearInterval(timer as unknown as NodeJS.Timeout);
      started.delete(guardKey);
      console.log(`[${name}] Loop stopped.`);
    },
  };
}
