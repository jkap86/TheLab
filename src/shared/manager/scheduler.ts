import { BOOT_STAGGER_MS, loopSwitch, startBackgroundLoop } from "@/shared/util";
import type { BackgroundLoopHandle } from "@/shared/util";

import { CRAWL_CONCURRENCY, CRAWL_LEAGUE_BATCH, runLeagueCrawl } from "./crawl";
import {
  createCrawlPressureGate,
  crawlerPressureConfig,
  fmtMb,
  memorySnapshot,
} from "./crawl-pressure";

/**
 * How often the background league crawl ticks. This is execution granularity,
 * not a freshness promise — how often any one league is re-fetched is the
 * seasonal TTL in `./crawl-ttl`, and how many leagues that TTL can cover is
 * `CRAWL_LEAGUE_BATCH × TTL / interval`.
 */
export const LEAGUE_CRAWL_INTERVAL_MS = 60 * 1000;

/** Set to `off` (case-insensitive) to disable the loop. */
export const LEAGUE_CRAWLER_VAR = "LEAGUE_CRAWLER";

/**
 * How often the crawler speaks when there is nothing to report: the idle
 * heartbeat, the lock-held note and the missed-target warning are each capped
 * to one line per this window. Quiet used to be ambiguous — a drained queue, a
 * dead scheduler and filtered logs all looked identical — so the heartbeat
 * makes health visible without a line per minute forever.
 */
const HEARTBEAT_MS = 15 * 60 * 1000;

/** Durations at log precision — "2.3s", "28m", "1.5h". */
function fmtMs(ms: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (ms >= 60 * 60 * 1000) return `${trim(ms / (60 * 60 * 1000))}h`;
  if (ms >= 60 * 1000) return `${trim(ms / (60 * 1000))}m`;
  return `${trim(ms / 1000)}s`;
}

/**
 * Start the in-process league crawl loop — see {@link startBackgroundLoop} for
 * the lifecycle guarantees (Node-only, idempotent, non-overlapping, and never
 * killed by a throwing tick).
 *
 * Every minute it re-syncs the stalest stored leagues and enumerates a few
 * league members to discover new leagues — see {@link runLeagueCrawl}. How long
 * a league stays fresh between re-syncs is seasonal (`./crawl-ttl`): 15 minutes
 * in the regular season, an hour through the draft window before kickoff, six
 * hours in the deep offseason. Each tick takes a Postgres advisory lock, so
 * running several app instances against one database doesn't multiply the load
 * on Sleeper.
 *
 * The tick logs a summary when it did work, a heartbeat when it has been quiet
 * for a while, and a warning when the stalest league is more than twice the
 * active TTL overdue — the sign the batch can't keep up with the corpus. Read
 * that telemetry before touching `CRAWL_LEAGUE_BATCH`.
 *
 * Set `LEAGUE_CRAWLER=off` to disable, on `KTC_SYNC`'s and `PLAYERS_SYNC`'s
 * exact terms — a local dev server that shouldn't be crawling in the background
 * is the case it is there for.
 *
 * **Every tick is admitted by the resource guard** (`./crawl-pressure`), whose
 * hysteresis latch lives in this closure and is handed to `runLeagueCrawl` on
 * each tick. A refused tick costs nothing — no pool connection, no advisory
 * lock, no Sleeper request — and the loop's own interval is the retry: there is
 * no polling here and no backoff of its own. A crawler paused across many ticks
 * says so once per heartbeat window, with the memory breakdown, because a pause
 * that never lifts is the one shape that is either honest or a leak and the
 * breakdown is what tells them apart. `CRAWLER_MEMORY_GUARD_ENABLED=false`
 * restores the unguarded behaviour exactly.
 *
 * **TheLabX runs this on a worker process and not on the one serving requests,
 * and the reason applies here whenever a second process appears.** The crawl
 * holds a pool connection across a league's whole Sleeper fan-out, so on a busy
 * web process it competes for connections with the requests it exists to fill
 * the cache for. What that separation needs is a mode gate rather than a
 * switch, and it arrives with the deploy that has somewhere to gate to; the
 * advisory lock already makes two instances correct rather than merely
 * survivable.
 */
export function startLeagueCrawler(): BackgroundLoopHandle {
  // Throttle state rides the closure, like the loop's own `ticking` guard: a
  // re-invoked start (dev/HMR) builds a closure the double-start guard never
  // ticks, so the running loop keeps the only live copy.
  let lastNoteMs = 0;
  let lastWarnMs = 0;
  let lastPressureMs = 0;
  let lockSkips = 0;
  /** Consecutive ticks the resource guard refused. */
  let pressureSkips = 0;

  // The hysteresis latch lives here for the same reason the throttles do — see
  // {@link createCrawlPressureGate}, which argues at length why this is a
  // closure rather than a module singleton.
  const gate = createCrawlPressureGate(
    crawlerPressureConfig({ maxConcurrency: CRAWL_CONCURRENCY }),
  );

  async function tick(): Promise<void> {
    const wasPaused = pressureSkips > 0;
    const s = await runLeagueCrawl({ gate });
    const now = Date.now();

    // One guard for both reasons, because `if (s.skipped)` is what narrows the
    // union: the skipped arm's discriminant is a *union* of literals, so
    // comparing it to one of them does not remove the arm — the truthiness test
    // does. See {@link CrawlSkip}.
    if (s.skipped) {
      if (s.skipped === "lock") {
        lockSkips += 1;
        if (now - lastNoteMs >= HEARTBEAT_MS) {
          lastNoteMs = now;
          console.log(
            `[crawl] Lock held by another instance; ` +
              `${lockSkips} tick(s) skipped since the last note.`,
          );
          lockSkips = 0;
        }
        return;
      }

      pressureSkips += 1;
      // The first refusal of a run speaks immediately — an operator watching a
      // dyno should see the crawler stand down at the moment it does — and
      // everything after it is throttled to the heartbeat, because a paused
      // crawler that logged every minute would be the loudest thing in the log
      // at exactly the moment the log is being read for something else.
      if (pressureSkips === 1 || now - lastPressureMs >= HEARTBEAT_MS) {
        lastPressureMs = now;
        const m = memorySnapshot();
        console.warn(
          `[crawl] Skipped for memory pressure — rss=${fmtMb(s.pressure.startRssMb)} ` +
            `(stop ${fmtMb(gate.config.stopMb)}, resume ${fmtMb(gate.config.resumeMb)}); ` +
            `${pressureSkips} tick(s) paused. ` +
            // The breakdown, and the reason it is here rather than in the guard:
            // a pause that never lifts while traffic is low is either an honestly
            // fat process or a leak, and which term is growing is what tells them
            // apart. Raising the thresholds until the crawler runs again would
            // bury exactly this.
            `heap=${m.heapUsedMb}/${m.heapTotalMb}MB external=${m.externalMb}MB ` +
            `buffers=${m.arrayBuffersMb}MB.`,
        );
      }
      return;
    }

    if (wasPaused) {
      console.log(
        `[crawl] Memory recovered — rss=${fmtMb(s.pressure.startRssMb)} ` +
          `(resume ${fmtMb(gate.config.resumeMb)}); resuming after ` +
          `${pressureSkips} paused tick(s).`,
      );
    }
    pressureSkips = 0;

    // Only a tick that found work can be this far behind — an idle tick means
    // nothing was due, so the stalest league was inside the TTL. Throttled on
    // its own stamp: sharing the summary's would silence it exactly when work
    // ticks print every minute, which is the regime it exists to catch.
    if (s.oldestAgeMs > 2 * s.leagueTtlMs && now - lastWarnMs >= HEARTBEAT_MS) {
      lastWarnMs = now;
      const capacity =
        (CRAWL_LEAGUE_BATCH * s.leagueTtlMs) / LEAGUE_CRAWL_INTERVAL_MS;
      console.warn(
        `[crawl] freshness target missed — tier=${s.tier} ` +
          `ttl=${fmtMs(s.leagueTtlMs)} corpus=${s.corpus} ` +
          `due=${s.dueBefore}→${s.due} oldest=${fmtMs(s.oldestAgeMs)} ` +
          `capacity=${capacity}/ttl`,
      );
    }

    // Both passes tombstone, and a tick that only did that is work — reported as
    // idle it would read as a drained queue while the crawler was retiring dead
    // leagues by the batch.
    const gone = s.gone + s.discoverGone;
    // A partial graph is work — rows were written — and it is also a league
    // still due, so a tick that only produced partials must not read as idle:
    // that is the one shape where "nothing happened" and "nothing is being
    // refreshed" would be the same line for opposite reasons.
    const partial = s.refreshPartial + s.discoverPartial;
    const touched =
      s.refreshed +
      s.discovered +
      partial +
      s.refreshFailed +
      s.discoverFailed +
      // A tick that only parked a failed first sync is work too, and reporting
      // it as idle would read as a drained queue at the exact moment discovery
      // is shedding leagues it cannot sync.
      s.discoverQueued +
      gone;
    const skipNote = lockSkips ? `; ${lockSkips} tick(s) lock-skipped` : "";
    // Only where the guard did something. A tick that ran at full width says
    // nothing about memory, which is the ordinary case and should stay silent.
    const p = s.pressure;
    const pressureNote =
      p.yielded || p.discoveryDeferred || p.endConcurrency < p.startConcurrency
        ? `; ${p.yielded ? "yielded" : "throttled"} at rss=${fmtMb(p.endRssMb)} ` +
          `(from ${fmtMb(p.startRssMb)}), concurrency ` +
          `${p.startConcurrency}→${p.endConcurrency}` +
          (p.leaguesRemaining ? `, ${p.leaguesRemaining} league(s) left unclaimed` : "") +
          (p.discoveryDeferred ? ", discovery deferred" : "") +
          (p.poolSaturated ? ", pool saturated" : "")
        : "";

    if (touched === 0) {
      // `lastNoteMs` starts at 0, so the boot tick heartbeats immediately —
      // "running" should be visible without waiting out a window. (It can print
      // above "Loop started"; the first tick fires before that line.)
      if (now - lastNoteMs < HEARTBEAT_MS) return;
      lastNoteMs = now;
      lockSkips = 0;
      console.log(
        s.corpus === 0
          ? `[crawl] Idle — no leagues stored yet${skipNote}${pressureNote}.`
          : `[crawl] Idle — ${s.tier} tier (ttl ${fmtMs(s.leagueTtlMs)}), ` +
              `${s.corpus} league(s) fresh ` +
              `(stalest ${fmtMs(s.oldestAgeMs)})${skipNote}${pressureNote}.`,
      );
      return;
    }

    lastNoteMs = now;
    lockSkips = 0;
    console.log(
      `[crawl] ${s.tier} tier (ttl ${fmtMs(s.leagueTtlMs)}): ` +
        `refreshed ${s.refreshed} of ${s.corpus} league(s), ` +
        `${s.due} still due (oldest ${fmtMs(s.oldestAgeMs)}); ` +
        `discovered ${s.discovered} from ${s.managersCrawled} member(s)` +
        (partial ? `; ${partial} partial (still due)` : "") +
        (s.refreshFailed || s.discoverFailed
          ? `; ${s.refreshFailed + s.discoverFailed} failed`
          : "") +
        (gone ? `; ${gone} gone from Sleeper` : "") +
        (s.discoverQueued
          ? `; ${s.discoverQueued} queued for refresh`
          : "") +
        (s.deferred ? `; ${s.deferred} member(s) deferred` : "") +
        skipNote +
        pressureNote +
        `; ${fmtMs(s.tickMs)}.`,
    );
  }

  return startBackgroundLoop({
    name: "crawl",
    intervalMs: LEAGUE_CRAWL_INTERVAL_MS,
    guardKey: "league-crawler",
    ...loopSwitch(LEAGUE_CRAWLER_VAR),
    cadence: "every 60s; league TTL 15m in-season, 1h draft window, 6h offseason",
    // Third of the four: it depends on none of them and holds the most memory
    // in flight at once, so it starts into a settled process. At a 60s cadence
    // the delay costs the corpus at most one rotation. See `BOOT_STAGGER_MS`.
    initialDelayMs: BOOT_STAGGER_MS.crawl,
    tick,
  });
}
