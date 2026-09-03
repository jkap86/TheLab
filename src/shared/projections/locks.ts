/**
 * Which players can no longer be moved: kickoff-accurate wherever the schedule
 * answers, day-accurate where it doesn't.
 *
 * Sleeper locks a starter at kickoff. The fallback can't say when that was —
 * the projections feed dates a game to the *day* (`SleeperProjection.date` is
 * `YYYY-MM-DD`), so on its own a 1pm game reads as movable until the date rolls
 * over in ET — but the kickoff ordering already reads the schedule's
 * `start_time` per team, and the same instants answer this to the minute.
 *
 * **The fold is a union, so a lock only ever arrives *earlier* than the day
 * rule, never later.** A kickoff still ahead does not unlock a player the day
 * rule has settled: trusting it to would let one stale or mismatched schedule
 * row un-settle a played game, and the promise every consumer of this set
 * makes — the gap column, the swap marks, the kickoff re-seat — is that it
 * never names a move Sleeper will refuse. What the union costs is the
 * postponed game, which stays locked once its original date passes; that is
 * exactly what the day rule already did, so nothing degrades below it. A
 * player the schedule can't date (no team on file, a bye, an unpublished
 * week) simply keeps the day answer.
 *
 * Pure and free of runtime imports, the usual two reasons — and it takes
 * `now` as an argument rather than reading a clock, so the moment a lock is
 * judged against is the caller's once per request, not one per player.
 */

/** What deciding the locks needs to know. */
export type LockInputs = {
  /** Every player under consideration — the account's roster union. */
  playerIds: readonly string[];
  /**
   * Players whose game *date* has passed — `week.ts`'s `dayLockedPlayers`,
   * the fallback the schedule refines and the whole answer without one.
   */
  dayLocked: ReadonlySet<string>;
  /** Player id → his NFL team; null or absent is "not known", never a guess. */
  teams: Readonly<Record<string, string | null>>;
  /** Team → kickoff instant for the week, epoch ms — `weekKickoffs`' answer. */
  kickoffs: ReadonlyMap<string, number>;
  /** The instant to judge against, epoch ms. */
  now: number;
};

/**
 * The players whose seats are settled for the week — see the module note for
 * the rule. A kickoff exactly at `now` locks: Sleeper locks *at* kickoff, and
 * the movable reading of that instant would name a move already refused.
 */
export function lockedPlayers({
  playerIds,
  dayLocked,
  teams,
  kickoffs,
  now,
}: LockInputs): Set<string> {
  const locked = new Set(dayLocked);

  for (const playerId of playerIds) {
    const team = teams[playerId];
    if (!team) continue;
    const kickoff = kickoffs.get(team);
    if (kickoff !== undefined && kickoff <= now) locked.add(playerId);
  }

  return locked;
}
