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
 * record, the page's record over its leagues, how many leagues are in play and
 * how many players in one, and what a seat's game clock says.
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
 * How many players each side of a league's week has on the field right now, or
 * **null where nothing is in play at all**.
 *
 * The card's in-play reading, folded here rather than in the component for the
 * reason everything else in this file is: the three states below render
 * perfectly when they are wrong, and null is one of them.
 *
 * - **Null is the zero state, and it is drawn as nothing.** Not a `0`, which
 *   beside a lit lamp is a claim that something is being watched, and not an
 *   em dash, which on this console reads as a figure the read failed to fetch.
 *   A week that has not kicked off, a week that is over and a bye all arrive
 *   here alike and all draw the bare rule the card has always had.
 * - **A null `theirs` is no opponent** — a future week, a week Sleeper filed
 *   without a pairing, an opponent whose roster is not stored — where a `0` is
 *   an opponent with nobody on the field. The card draws the first as one
 *   figure and the second as two, so the distinction is on screen.
 * - **A `mine` of `0` beside a live `theirs` is drawn**, because something
 *   *is* being watched: none of yours and three of theirs is the reading, and
 *   it is one a reader scanning a Sunday wants.
 *
 * The figures are the wire's own — see `GametimeSide.players_in_play`
 * for why they are counted on the server, which is also why this takes an
 * entry rather than a side and a scoreboard: a closed card is handed no board
 * at all, so a count walked from one would read zero on every card but the one
 * that happens to be open.
 */
export function playersInPlay(
  entry: GametimeLeague | null | undefined,
): { mine: number; theirs: number | null } | null {
  if (!entry) return null;
  const mine = entry.mine.players_in_play;
  const theirs = entry.opponent ? entry.opponent.players_in_play : null;
  if (mine === 0 && (theirs ?? 0) === 0) return null;
  return { mine, theirs };
}

/**
 * How many of the leagues on screen have a player — theirs or the opponent's
 * — whose game is running right now. The header's second count, and the one
 * figure on the page that says whether there is anything to watch.
 *
 * **It reads the same figure the cards under it print**, which is what stops
 * the header and a card disagreeing on one screen: `status.live` counts
 * *seats*, and a best-ball league's seats are a lineup Sleeper has not seated
 * yet — so a bench player whose game was running left the league out of this
 * count while the card beneath it read a figure that included him.
 */
export function leaguesInPlay(
  leagues: readonly { league_id: string }[],
  entries: Readonly<Record<string, GametimeLeague>>,
): number {
  let count = 0;
  for (const league of leagues) {
    if (playersInPlay(entries[league.league_id]) !== null) count++;
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
