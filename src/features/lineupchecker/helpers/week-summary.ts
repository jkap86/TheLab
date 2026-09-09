import type { LineupCheckLeague } from "@/shared/contract";

import {
  formatRecord,
  formatWeekRecord,
  formatWeekWinPct,
  summariseWeekRecords,
  weekRecordOf,
} from "../../shared/week-record.ts";
import type {
  LeagueWeekRecord,
  WeekGame,
  WeekRecordSummary,
} from "../../shared/week-record.ts";

/**
 * The checker's reading of a week's record: the projected outcome per league
 * and the page's projected record over them.
 *
 * The fold itself is `features/shared/week-record` — the gametime page reads
 * the same rule over live figures, and one spelling is what keeps a league
 * that is `2–0` on one page from reading `1–1` on the other. This module is
 * the checker's join between its contract and that fold, read relatively with
 * `.ts` because its test runs under Node's runner.
 *
 * `leagueWeekRecord` is the card's plate and the page's record, one function,
 * so a league that is `2–0` on its own card cannot contribute `1–0` to the
 * plate above it. See `weekRecordOf` for why the head-to-head gates it.
 */
export type { LeagueWeekRecord, WeekGame };
export type WeekSummary = WeekRecordSummary;

export function leagueWeekRecord(
  entry: LineupCheckLeague | null | undefined,
): LeagueWeekRecord | null {
  if (!entry) return null;
  return weekRecordOf(entry.current_points, entry.opponent_points, entry.median_points);
}

/**
 * The week's projected record over the leagues on screen — see
 * `summariseWeekRecords` for what it counts and why a league with no opponent
 * is excluded rather than counted as a loss.
 */
export function weekSummary(
  leagues: readonly { league_id: string }[],
  checked: Readonly<Record<string, LineupCheckLeague>>,
): WeekSummary {
  return summariseWeekRecords(
    leagues.map((league) => leagueWeekRecord(checked[league.league_id])),
  );
}

export { formatRecord };
/** The page's record, or an em dash where no game was projected. */
export const formatProjectedRecord = formatWeekRecord;
/** `50.0%`, or an em dash where there is nothing to divide. */
export const formatProjectedWinPct = formatWeekWinPct;
