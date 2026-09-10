import type { GametimeLeague, ManagerGametimePayload } from "@/shared/contract";
import { gameBoard, solveGametimeLeague } from "@/shared/manager";
import type { ManagerWeekLineupRow } from "@/shared/manager";

import type { WeekFeeds } from "./feeds";

/**
 * One week's answer, from the stored lineups and the feeds — the plain route's
 * and the room's one spelling of the payload, so a frame pushed over the
 * stream and a body answered to a fetch are the same object.
 *
 * A failed projections read empties `leagues` and says so; a league with no
 * slots on file is absent rather than zero, on `solveWeekLineup`'s rule.
 */
export function buildGametimePayload(input: {
  season: string;
  week: number;
  leagues: readonly ManagerWeekLineupRow[];
  feeds: WeekFeeds;
}): ManagerGametimePayload {
  const { season, week, leagues, feeds } = input;
  const solved: Record<string, GametimeLeague> = {};

  if (feeds.projections) {
    // `pricingClocks`, never `clocks`: the board below is what a reader is
    // *shown* and this is what the week is *priced* against, and the two part
    // company the moment a scoreboard request fails. See `WeekFeeds`.
    const boards = {
      projections: feeds.projections,
      stats: feeds.stats,
      clocks: feeds.pricingClocks,
    };
    for (const league of leagues) {
      const entry = solveGametimeLeague(league, boards);
      if (entry) solved[league.league_id] = entry;
    }
  }

  return {
    season,
    week,
    projections: feeds.statuses.projections,
    stats: feeds.statuses.stats,
    scores: feeds.statuses.scores,
    read_at: feeds.readAt,
    games: feeds.games,
    board: gameBoard(feeds.clocks),
    leagues: solved,
  };
}
