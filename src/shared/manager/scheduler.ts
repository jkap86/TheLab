import { startBackgroundLoop } from "@/shared/util";

import { runLeagueCrawl } from "./crawl";

/** How often the background league crawl ticks. */
export const LEAGUE_CRAWL_INTERVAL_MS = 60 * 1000;

async function tick(): Promise<void> {
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
}

/**
 * Start the in-process league crawl loop — see {@link startBackgroundLoop} for
 * the lifecycle guarantees (Node-only, idempotent, non-overlapping, and never
 * killed by a throwing tick).
 *
 * Every minute it re-syncs the stalest stored leagues and enumerates a few
 * league members to discover new leagues — see {@link runLeagueCrawl}. Each tick
 * takes a Postgres advisory lock, so running several app instances against one
 * database doesn't multiply the load on Sleeper.
 *
 * Set `LEAGUE_CRAWLER=off` to disable (e.g. for a local dev server that
 * shouldn't be crawling in the background).
 */
export function startLeagueCrawler(): void {
  startBackgroundLoop({
    name: "crawl",
    intervalMs: LEAGUE_CRAWL_INTERVAL_MS,
    guardKey: "league-crawler",
    enabled: process.env.LEAGUE_CRAWLER !== "off",
    disabledReason: "LEAGUE_CRAWLER=off",
    cadence: "every 60s",
    tick,
  });
}
