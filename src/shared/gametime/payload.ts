import type { GametimeLeague, ManagerGametimePayload } from "@/shared/contract";
import { gameBoard, solveGametimeLeague } from "@/shared/manager";
import type { ManagerWeekLineupRow } from "@/shared/manager";

import { statBoardLines } from "./stat-lines";
import type { WeekFeeds } from "./feeds";

/**
 * One week's answer, from the stored lineups and the feeds — the plain route's
 * and the room's one spelling of the payload, so a frame pushed over the
 * stream and a body answered to a fetch are the same object.
 *
 * A failed projections read empties `leagues` and says so; a league with no
 * slots on file is absent rather than zero, on `solveWeekLineup`'s rule.
 * `players` is the week's stat board and stands apart from all of it: it is
 * folded off the stat lines alone, so it survives a projections read that
 * emptied every league.
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
    // The week's own reading, folded off the *stats* feed and no league's
    // business — see `statBoardLines`. It is built whether or not any league
    // could be solved, because it does not depend on one: a projections read
    // that failed empties `leagues` and leaves the board standing, which is
    // the honest pair.
    players: statBoardLines(feeds.stats),
    leagues: solved,
  };
}
