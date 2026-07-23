import { runLeagueCrawl } from "./crawl";

/** How often the background league crawl ticks. */
export const LEAGUE_CRAWL_INTERVAL_MS = 60 * 1000;

const globalForScheduler = globalThis as unknown as {
  leagueCrawlerStarted?: boolean;
};

/** Guards against a slow tick overlapping the next interval in this process. */
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;

  try {
    const s = await runLeagueCrawl();
    if (s.locked) return;

    const touched =
      s.refreshed + s.discovered + s.refreshFailed + s.discoverFailed + s.gone;
    if (touched === 0) return; // nothing due — stay quiet

    console.log(
      `[crawl] Refreshed ${s.refreshed} league(s), ${s.due} still due; ` +
        `discovered ${s.discovered} from ${s.managersCrawled} member(s)` +
        (s.refreshFailed || s.discoverFailed
          ? `; ${s.refreshFailed + s.discoverFailed} failed`
          : "") +
        (s.gone ? `; ${s.gone} gone from Sleeper` : "") +
        (s.deferred ? `; ${s.deferred} member(s) deferred` : "") +
        ".",
    );
  } catch (error) {
    // Never let one bad tick kill the interval — log and try again next minute.
    console.error("[crawl] Tick failed:", error);
  } finally {
    ticking = false;
  }
}

/**
 * Start the in-process league crawl loop. Idempotent: guarded on globalThis so
 * Next.js dev/HMR reloads and repeated instrumentation runs don't stack timers.
 *
 * Every minute it re-syncs the stalest stored leagues and enumerates a few
 * league members to discover new leagues — see {@link runLeagueCrawl}. The timer
 * is `unref`'d so it never keeps the process alive on its own, and each tick
 * takes a Postgres advisory lock, so running several app instances against one
 * database doesn't multiply the load on Sleeper.
 *
 * Set `LEAGUE_CRAWLER=off` to disable (e.g. for a local dev server that
 * shouldn't be crawling in the background).
 */
export function startLeagueCrawler(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.LEAGUE_CRAWLER === "off") {
    console.log("[crawl] League crawler disabled (LEAGUE_CRAWLER=off).");
    return;
  }
  if (globalForScheduler.leagueCrawlerStarted) return;
  globalForScheduler.leagueCrawlerStarted = true;

  // First tick runs without blocking boot.
  void tick();

  const timer = setInterval(() => void tick(), LEAGUE_CRAWL_INTERVAL_MS);
  // `unref` exists on Node's Timeout; the cast guards the DOM `setInterval`
  // typing (returns `number`) that tsconfig's `lib: ["dom"]` can pull in.
  (timer as { unref?: () => void }).unref?.();

  console.log("[crawl] League crawler started (every 60s).");
}
