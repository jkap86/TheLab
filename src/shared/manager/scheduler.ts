import { refreshStaleTradeStats } from "@/shared/trades";
import { backgroundJobSwitch, startBackgroundLoop } from "@/shared/util";

import { CRAWL_LEAGUE_BATCH, runLeagueCrawl } from "./crawl";

/**
 * How often the background league crawl ticks. This is execution granularity,
 * not a freshness promise — how often any one league is re-fetched is the
 * seasonal TTL in `./crawl-ttl`, and how many leagues that TTL can cover is
 * `CRAWL_LEAGUE_BATCH × TTL / interval`.
 */
export const LEAGUE_CRAWL_INTERVAL_MS = 60 * 1000;

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
 * Set `LEAGUE_CRAWLER=off` to disable (e.g. for a local dev server that
 * shouldn't be crawling in the background), or `BACKGROUND_JOBS=off` to disable
 * every loop at once — which is how a web dyno is configured when a worker is
 * doing the crawling. This is the loop that most wants that separation: it holds
 * a pool connection across a league's whole Sleeper fan-out, so on a busy web
 * process it is competing for connections with the requests it is meant to be
 * filling the cache for.
 */
export function startLeagueCrawler(): void {
  // Throttle state rides the closure, like the loop's own `ticking` guard: a
  // re-invoked start (dev/HMR) builds a closure the double-start guard never
  // ticks, so the running loop keeps the only live copy.
  let lastNoteMs = 0;
  let lastWarnMs = 0;
  let lockSkips = 0;

  async function tick(): Promise<void> {
    const s = await runLeagueCrawl();
    const now = Date.now();

    // The trades board's precomputed size rides on this tick rather than on a
    // loop of its own, because this is the loop that *writes* the trades it
    // counts and it already runs on a cadence matched to how fast they arrive.
    // It takes its own advisory lock and gates on its own TTL, so on most ticks
    // it is one indexed lookup; a failure is logged and never reaches the crawl
    // summary, since a stale denominator on a progress line is not a crawl
    // problem. Awaited rather than fired off: an unawaited promise inside a
    // non-overlapping loop is how work starts stacking invisibly.
    await refreshStaleTradeStats().catch((error) => {
      console.error("[trades] stats refresh failed:", error);
    });

    if (s.locked) {
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
    const touched =
      s.refreshed +
      s.discovered +
      s.refreshFailed +
      s.discoverFailed +
      // A tick that only parked a failed first sync is work too, and reporting
      // it as idle would read as a drained queue at the exact moment discovery
      // is shedding leagues it cannot sync.
      s.discoverQueued +
      gone;
    const skipNote = lockSkips ? `; ${lockSkips} tick(s) lock-skipped` : "";

    if (touched === 0) {
      // `lastNoteMs` starts at 0, so the boot tick heartbeats immediately —
      // "running" should be visible without waiting out a window. (It can print
      // above "Loop started"; the first tick fires before that line.)
      if (now - lastNoteMs < HEARTBEAT_MS) return;
      lastNoteMs = now;
      lockSkips = 0;
      console.log(
        s.corpus === 0
          ? `[crawl] Idle — no leagues stored yet${skipNote}.`
          : `[crawl] Idle — ${s.tier} tier (ttl ${fmtMs(s.leagueTtlMs)}), ` +
              `${s.corpus} league(s) fresh ` +
              `(stalest ${fmtMs(s.oldestAgeMs)})${skipNote}.`,
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
        (s.refreshFailed || s.discoverFailed
          ? `; ${s.refreshFailed + s.discoverFailed} failed`
          : "") +
        (gone ? `; ${gone} gone from Sleeper` : "") +
        (s.discoverQueued
          ? `; ${s.discoverQueued} queued for refresh`
          : "") +
        (s.deferred ? `; ${s.deferred} member(s) deferred` : "") +
        skipNote +
        `; ${fmtMs(s.tickMs)}.`,
    );
  }

  startBackgroundLoop({
    name: "crawl",
    intervalMs: LEAGUE_CRAWL_INTERVAL_MS,
    guardKey: "league-crawler",
    ...backgroundJobSwitch("crawler"),
    cadence: "every 60s; league TTL 15m in-season, 1h draft window, 6h offseason",
    tick,
  });
}
