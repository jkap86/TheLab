import type { SleeperNflState } from "@/shared/sleeper";

/**
 * Seasonal freshness tiers for the league crawler's refresh queue.
 *
 * The refresh pass can retire at most `CRAWL_LEAGUE_BATCH` leagues per tick, so
 * a TTL is only a real promise up to `batch × TTL / interval` leagues — 225 at
 * 15 minutes, 900 at an hour, 5,400 at six. One year-round TTL therefore has to
 * choose between missing that target in-season and re-fetching a near-static
 * corpus 96 times a day all offseason. The tiers match the TTL to how fast the
 * leagues actually move: waivers and trades run weekly in-season; during draft
 * season new leagues and fresh drafts arrive daily, and the drafts are what the
 * lineups route's ADP fallback and the trades board's pick labels are read
 * from; deep offseason, rosters barely move at all.
 */
export const REGULAR_SEASON_LEAGUE_TTL_MS = 15 * 60 * 1000;
export const DRAFT_SEASON_LEAGUE_TTL_MS = 60 * 60 * 1000;
export const OFFSEASON_LEAGUE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How far before kickoff "draft season" begins. A crawler policy choice, not an
 * NFL fact — late June is when startup drafts pick up.
 */
export const DRAFT_SEASON_WINDOW_DAYS = 75;

export type CrawlTier = "regular" | "draft" | "offseason";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pick the refresh TTL for this tick from the raw NFL state.
 *
 * Raw, not `getSyncClock()`'s floored week: the week-0 floor makes the offseason
 * and real week 1 indistinguishable, which is exactly the distinction this
 * exists to draw. Only `"regular"` is matched by name — every other `season_type` is
 * decided by distance from kickoff, because Sleeper labels most of the offseason
 * "off" and flips to "pre" only around the preseason games, so a gate on either
 * spelling silently reclassifies the weeks in between. Postseason lands in the
 * offseason tier the same way: its kickoff is months past, far outside the
 * window.
 *
 * Anything unparseable falls back to the *freshest* tier — a malformed date
 * must degrade to extra fetches, never to a stale cache. (An in-range-but-fake
 * date like `2026-02-31` is not malformed to V8, which rolls it forward to a
 * real day — the `isIsoDate` trap — so it takes that day's tier instead.)
 */
export function leagueCrawlTtl(
  state: Pick<SleeperNflState, "season_type" | "season_start_date"> | null,
  nowMs: number = Date.now(),
): { ttlMs: number; tier: CrawlTier } {
  if (state?.season_type === "regular") {
    return { ttlMs: REGULAR_SEASON_LEAGUE_TTL_MS, tier: "regular" };
  }

  const startMs = Date.parse(state?.season_start_date ?? "");
  if (!Number.isFinite(startMs)) {
    return { ttlMs: REGULAR_SEASON_LEAGUE_TTL_MS, tier: "regular" };
  }

  // Date-only parses land on UTC midnight, so kickoff day itself can read as
  // slightly past the window for a few hours before Sleeper flips the type to
  // "regular" — a brief stint in the slow tier, accepted to keep the bound at 0.
  const daysUntilKickoff = (startMs - nowMs) / DAY_MS;
  if (daysUntilKickoff >= 0 && daysUntilKickoff <= DRAFT_SEASON_WINDOW_DAYS) {
    return { ttlMs: DRAFT_SEASON_LEAGUE_TTL_MS, tier: "draft" };
  }

  return { ttlMs: OFFSEASON_LEAGUE_TTL_MS, tier: "offseason" };
}
