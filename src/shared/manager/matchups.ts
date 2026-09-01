/**
 * Rules about the rows behind a league's weekly scoring.
 *
 * Pure like its neighbours (`rank`, `draft-picks`, `shares`), so it unit-tests
 * without a fetch behind it; `persist` hands it what a sync fetched. Its one
 * runtime import is `./dedupe.ts`, taken relatively with the extension for the
 * reason every pure→pure import here is: an alias breaks Node's test runner.
 */

import { dedupeBy } from "./dedupe.ts";

/** The part of a fetched matchup row that identifies it in the table. */
type RosterWeek = { week: number; roster_id: number };

/**
 * Collapse fetched matchups to one row per (week, roster), keeping the last.
 *
 * That pair is the table's primary key. Why a repeat has to be collapsed in code
 * rather than absorbed by the conflict clause is {@link dedupeBy}'s to explain;
 * what belongs here is the *key* — a roster scores once a week, and Sleeper
 * sending it twice describes the same roster-week either way, so the later row
 * wins exactly as the clause would have had it.
 */
export function dedupeMatchups<T extends RosterWeek>(matchups: readonly T[]): T[] {
  return dedupeBy(matchups, (m) => `${m.week}:${m.roster_id}`);
}
