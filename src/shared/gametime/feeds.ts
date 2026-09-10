import { getWeekProjections, getWeekStats } from "@/shared/projections";
import type { WeekProjections } from "@/shared/projections";
import { clockSignature, getWeekGameClocks, phaseCounts } from "@/shared/schedule";
import type { GameClock, GamePhase } from "@/shared/schedule";
import type { GametimeFeedStatus } from "@/shared/contract";

import { feedSignature } from "./live-rules";

/**
 * The three feeds a week's live solve reads, read together and each allowed
 * to fail on its own.
 *
 * The projections board is `week-read`'s (five minutes), the stat lines are
 * `week-stats-read`'s (twenty seconds) and the clocks are `schedule/live`'s
 * (twenty seconds) — so a room ticking every twenty seconds and a reader of
 * the plain route in the same second share one fetch of each. The plain route
 * and the room both build their answer from this one shape, which is what
 * keeps the two from pricing a week two ways.
 */
export type WeekFeeds = {
  /** Null where the projections read failed — nothing can be priced. */
  projections: WeekProjections | null;
  /** Null where the stats read failed — see `GametimeBoards.stats`. */
  stats: WeekProjections | null;
  /**
   * The clocks as a reader may be *shown* them: the last scoreboard this
   * process read, whether or not the newest request for it answered. Null only
   * where none was ever read.
   *
   * What is drawn from these is the board on the wire, the phase counts and
   * the room's own cadence — all three being better served by a reading twenty
   * seconds old than by nothing. They are **not** what the week is priced
   * against; see {@link WeekFeeds.pricingClocks}.
   */
  clocks: ReadonlyMap<string, GameClock> | null;
  /**
   * The clocks a live projection may be computed from — the same map, and
   * **null the moment the current scoreboard read has failed**.
   *
   * The two are separate because a clock is two different claims. As a caption
   * beside a name, `Q3 08:41` says where the game was when we last saw it, and
   * ageing makes it merely old. As a *factor*, it says what share of the game
   * is still to be played, and a stale one keeps saying it: a scoreboard that
   * stopped answering at the top of the third quarter would go on pricing
   * every roster in the league at 39% remaining for the rest of the afternoon,
   * with the numbers moving underneath it as the stat lines came in — the one
   * failure this tool cannot have, because it renders as an ordinary Sunday.
   * Null hands the solve back to the fallback it already has for a scoreboard
   * nobody could read.
   */
  pricingClocks: ReadonlyMap<string, GameClock> | null;
  statuses: { projections: GametimeFeedStatus; stats: GametimeFeedStatus; scores: GametimeFeedStatus };
  /** Games on the board by phase, counted once per game. */
  games: Record<GamePhase, number>;
  /** The earliest kickoff among games still to start, or null where none is known. */
  nextKickoff: number | null;
  /** What a room compares tick to tick — see `feedSignature`. */
  signature: string;
  readAt: number;
};

/**
 * Read the week's three feeds.
 *
 * **It never throws.** Each feed degrades on its own, and the statuses say
 * which did: a failed projections read is the one that empties the page (the
 * checker's own rule — a page of confident zeroes is the one outcome this must
 * not have), a failed stats read prices the week as a projection, and a failed
 * scoreboard read prices every projection whole. A scoreboard read that
 * answered stale is reported as `"error"` too, because the clocks it holds are
 * a claim about twenty seconds ago at best — and, since this pass, it is not
 * only *reported* stale but withheld from the pricing: see
 * {@link WeekFeeds.pricingClocks}.
 */
export async function readWeekFeeds(season: string, week: number): Promise<WeekFeeds> {
  const [projections, stats, clocks] = await Promise.allSettled([
    getWeekProjections(season, week),
    getWeekStats(season, week),
    getWeekGameClocks(season, week),
  ]);

  const board = projections.status === "fulfilled" ? projections.value : null;
  const lines = stats.status === "fulfilled" ? stats.value : null;
  // `getWeekGameClocks` never rejects, but `allSettled` does not know that.
  const read = clocks.status === "fulfilled" ? clocks.value : null;
  const clockMap = read && read.ok ? read.clocks : (read?.clocks.size ? read.clocks : null);

  if (projections.status === "rejected") {
    console.warn(`[gametime] projections unavailable for ${season} week ${week}:`, projections.reason);
  }
  if (stats.status === "rejected") {
    console.warn(`[gametime] stats unavailable for ${season} week ${week}:`, stats.reason);
  }

  const games = clockMap ? phaseCounts(clockMap) : { pre: 0, live: 0, final: 0 };

  return {
    projections: board,
    stats: lines?.board ?? null,
    clocks: clockMap,
    // The current read is what says a clock may be priced from — a stale map
    // is a caption, never a factor. See the field's own note.
    pricingClocks: read?.ok ? clockMap : null,
    statuses: {
      projections: board ? "ok" : "error",
      stats: lines ? "ok" : "error",
      scores: read?.ok ? "ok" : "error",
    },
    games,
    nextKickoff: clockMap ? nextKickoffOf(clockMap) : null,
    signature: feedSignature({
      stats: lines?.stamp ?? "error",
      clocks: clockMap ? clockSignature(clockMap) : "error",
    }),
    readAt: Date.now(),
  };
}

/** The earliest kickoff among games that have not started, or null. */
function nextKickoffOf(clocks: ReadonlyMap<string, GameClock>): number | null {
  let earliest: number | null = null;
  for (const game of clocks.values()) {
    if (game.phase !== "pre" || game.kickoff === null) continue;
    if (earliest === null || game.kickoff < earliest) earliest = game.kickoff;
  }
  return earliest;
}
