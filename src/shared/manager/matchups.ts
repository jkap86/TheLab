/**
 * Rules about the rows behind a league's weekly scoring.
 *
 * Pure and free of runtime imports so it unit-tests like its neighbours
 * (`rank`, `draft-picks`, `shares`); `persist` hands it what a sync fetched.
 */

/** The part of a fetched matchup row that identifies it in the table. */
type RosterWeek = { week: number; roster_id: number };

/**
 * Collapse fetched matchups to one row per (week, roster), keeping the last.
 *
 * That pair is the table's primary key, and a multi-row INSERT carrying it twice
 * is a hard error *even with* an `ON CONFLICT DO UPDATE` clause: Postgres will
 * not let one command affect a row twice, so the clause covers chunk boundaries
 * and nothing inside a chunk. Sleeper should never send a roster twice in one
 * week — but the cost of it doing so is the league's whole sync transaction,
 * every collection in it, which is far too much to lose to a payload quirk.
 *
 * The rows describe the same roster-week either way, so the later one wins,
 * matching what the conflict clause would have done.
 */
export function dedupeMatchups<T extends RosterWeek>(matchups: readonly T[]): T[] {
  const byRosterWeek = new Map<string, T>();
  for (const m of matchups) byRosterWeek.set(`${m.week}:${m.roster_id}`, m);
  return [...byRosterWeek.values()];
}
