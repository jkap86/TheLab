import type { GametimeGame, GametimeLeague } from "@/shared/contract";

import { kickoffTime } from "../../shared/format.ts";
import {
  formatWeekRecord,
  formatWeekWinPct,
  summariseWeekRecords,
  weekRecordOf,
} from "../../shared/week-record.ts";
import type { LeagueWeekRecord, WeekRecordSummary } from "../../shared/week-record.ts";

/**
 * The gametime page's readings, pure and under Node's runner: a league's live
 * record, the page's record over its leagues, how many leagues are in play,
 * and what a seat's game clock says.
 *
 * The record fold is `features/shared/week-record`, the same one the lineup
 * checker projects a week with — read relatively with `.ts` for Node's sake.
 * The figures it is fed are the **live** projections: a league on course to
 * win is a win here, exactly as a league projected to win is one there, and
 * the two pages count a median league as two games alike.
 */
export type { LeagueWeekRecord, WeekRecordSummary };

/** A league's week on its live projections, or null where there is no opponent. */
export function leagueLiveRecord(
  entry: GametimeLeague | null | undefined,
): LeagueWeekRecord | null {
  if (!entry) return null;
  return weekRecordOf(entry.mine.live, entry.opponent?.live ?? null, entry.median?.live ?? null);
}

/** The page's live record over the leagues on screen. */
export function liveSummary(
  leagues: readonly { league_id: string }[],
  entries: Readonly<Record<string, GametimeLeague>>,
): WeekRecordSummary {
  return summariseWeekRecords(
    leagues.map((league) => leagueLiveRecord(entries[league.league_id])),
  );
}

/**
 * How many of the leagues on screen have a starter — theirs or the opponent's
 * — whose game is running right now. The header's second count, and the one
 * figure on the page that says whether there is anything to watch.
 */
export function leaguesInPlay(
  leagues: readonly { league_id: string }[],
  entries: Readonly<Record<string, GametimeLeague>>,
): number {
  let count = 0;
  for (const league of leagues) {
    const entry = entries[league.league_id];
    if (!entry) continue;
    if (entry.mine.status.live > 0 || (entry.opponent?.status.live ?? 0) > 0) count++;
  }
  return count;
}

/** The leagues on screen the read answered for — the count's denominator. */
export function leaguesAnswered(
  leagues: readonly { league_id: string }[],
  entries: Readonly<Record<string, GametimeLeague>>,
): number {
  return leagues.filter((league) => entries[league.league_id] !== undefined).length;
}

/** The page's record as printed, or an em dash where nothing is in play. */
export const formatLiveRecord = formatWeekRecord;
export const formatLiveWinPct = formatWeekWinPct;

/**
 * What a seat's game clock reads.
 *
 * Four states in one column, and the column is the reason a live page exists:
 * a kickoff still to come prints as the reader's clock prints it (`Sun 1:00
 * PM`), a running game prints its quarter and clock (`Q3 5:32`, `Half`,
 * `OT 4:12`), a finished one prints `Final`, and a player with no game — a
 * bye, or a scoreboard nobody could read — prints nothing at all rather than
 * an em dash, which in a column of clocks would read as a game with no time
 * on it.
 *
 * `live` is what the row inks: a running game is the one reading a reader
 * scanning the column is looking for.
 */
export function gameClockLabel(game: GametimeGame | null): { text: string; live: boolean } {
  if (!game) return { text: "", live: false };
  if (game.phase === "final") return { text: "Final", live: false };
  if (game.phase === "pre") return { text: kickoffTime(game.kickoff) ?? "", live: false };
  if (game.overtime) return { text: game.clock ? `OT ${game.clock}` : "OT", live: true };
  if (game.quarter === 2 && game.clock === "00:00") return { text: "Half", live: true };
  if (game.quarter !== null && game.clock !== null) {
    return { text: `Q${game.quarter} ${game.clock}`, live: true };
  }
  return { text: "Live", live: true };
}

/**
 * A game's score from the seat's side, `21–17`, or null before kickoff. What
 * the clock's `title` carries beside the reading, since a column has no room
 * for both.
 */
export function gameScoreLabel(game: GametimeGame | null): string | null {
  if (!game || !game.score) return null;
  return `${game.score.team}–${game.score.opponent}`;
}
