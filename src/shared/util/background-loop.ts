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
   * How long to wait before the boot tick — and, with it, before the interval
   * starts running. Defaults to 0, which is a boot tick fired synchronously on
   * start and is exactly what every loop did before this existed.
   *
   * **It staggers a cold boot, and it is not a rate limit.** Four loops start
   * in one `register()` and on a 512 MB dyno all four were reaching for
   * Sleeper, the pool and a few megabytes of parsed JSON in the same instant —
   * beside the first requests the dyno is also trying to serve. Spreading the
   * *first* tick is enough, because after that the four cadences (15m, daily,
   * 60s, daily) have nothing to keep in phase.
   *
   * **The interval is armed when the delayed boot tick fires, not at start**,
   * which is what keeps the cadence honest: armed at start, a loop delayed 45s
   * against a 60s interval would tick at 45s and again at 60s. Every recurring
   * gap is `intervalMs` either way; what moves is only where the sequence
   * begins. Both timers are `unref`'d and {@link BackgroundLoopHandle.stop}
   * clears whichever is pending, so a loop stopped inside its delay never
   * ticks at all.
   */
  initialDelayMs?: number;
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
 * The first tick runs immediately without blocking startup — or after
 * {@link BackgroundLoop.initialDelayMs}, where a caller staggers a cold boot.
 */
export function startBackgroundLoop({
  name,
  intervalMs,
  guardKey,
  enabled = true,
  disabledReason,
  cadence,
  initialDelayMs = 0,
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

  // `unref` exists on Node's Timeout; the cast guards the DOM `setInterval`
  // typing (returns `number`) that tsconfig's `lib` can pull in.
  const unref = (timer: unknown) => {
    (timer as { unref?: () => void }).unref?.();
    return timer as NodeJS.Timeout;
  };

  // Exactly one of these is live at a time: the delay, then the interval it
  // arms. `stop` clears whichever it finds, which is what makes a loop stopped
  // inside its own delay a loop that never ticks.
  let pending: NodeJS.Timeout | null = null;

  const arm = () => {
    pending = unref(setInterval(() => void runTick(false), intervalMs));
  };

  const boot = () => {
    // The interval is armed *before* the tick is fired and not after it: a tick
    // is not awaited here (that is what the re-entry guard is for), so awaiting
    // one to arm the timer would mean a tick that never settled left the loop
    // with no timer at all.
    arm();
    void runTick(true);
  };

  if (initialDelayMs > 0) {
    pending = unref(setTimeout(boot, initialDelayMs));
  } else {
    boot();
  }

  const stagger =
    initialDelayMs > 0
      ? `; first tick in ${Math.round(initialDelayMs / 1000)}s`
      : "";
  console.log(`[${name}] Loop started (${cadence}${stagger}).`);

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
      // One handle holds two kinds of timer over its life — the initial delay,
      // then the interval that delay arms — and never both at once. Node's
      // `clearTimeout` and `clearInterval` are interchangeable on a `Timeout`,
      // so clearing whichever one is outstanding is the whole of it.
      if (pending !== null) {
        clearInterval(pending);
        pending = null;
      }
      started.delete(guardKey);
      console.log(`[${name}] Loop stopped.`);
    },
  };
}
