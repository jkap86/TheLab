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
 *   - **Node-only.** Skipped outside the Node.js runtime, since these touch
 *     `pg` and must never run on the Edge.
 *   - **Idempotent.** Guarded on `globalThis` so dev/HMR reloads don't stack
 *     timers, which would silently multiply the load on the upstream API.
 *   - **Non-overlapping.** A tick that outruns the interval is not re-entered;
 *     the next interval is skipped instead of piling on.
 *   - **Unkillable.** A throwing tick is logged, never propagated — one bad
 *     tick must not take the interval down with it.
 *
 * The timer is `unref`'d, so the loop never holds the process open by itself.
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
}: BackgroundLoop): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!enabled) {
    console.log(`[${name}] Loop disabled${disabledReason ? ` (${disabledReason})` : ""}.`);
    return;
  }

  if (started.has(guardKey)) return;
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
}
