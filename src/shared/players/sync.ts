import {
  bulkInsert,
  countRows,
  isFresh,
  jsonb as j,
  LOCK_KEYS,
  withAdvisoryLock,
  withTransaction,
} from "@/shared/db";
import { getAllPlayers } from "@/shared/sleeper";

/**
 * How long the stored players map stays fresh.
 *
 * Sleeper asks that `/v1/players/nfl` be fetched at most once a day, and this
 * is that ask spelled as a TTL. It is also the interval the scheduler ticks on,
 * so a running process refreshes exactly once a day and a restart inside the
 * window refreshes nothing.
 */
export const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000;

export type PlayersSyncSummary = {
  /**
   * True when another instance held the lock and this run did nothing — the
   * same field the KTC sync carries. Without it a caller couldn't tell a
   * fresh-cache skip from someone else's in-flight download, which is the
   * difference between "nothing to do" and "try again shortly".
   */
  locked: boolean;
  skipped: boolean;
  count: number;
};

/**
 * Refresh the stored Sleeper players map, skipping the (large) download while
 * the rows are still fresh unless `force` is set.
 *
 * **The advisory lock wraps the freshness check, not just the fetch** —
 * otherwise every instance decides for itself that a refresh is due and they
 * queue up to download ~5MB in turn, from the one endpoint Sleeper asks be hit
 * at most once a day. A caller that loses the race treats the winner's run as
 * its own: the map is being refreshed either way.
 *
 * The whole map is held in memory once, as the parsed object, and written in
 * chunks of 500 rows inside one transaction — so the peak is that object plus
 * one chunk's bound parameters rather than ~12k rows of SQL at once. One
 * transaction because a half-written map is a board that names some players and
 * not others.
 */
export async function syncPlayers(
  options: { force?: boolean } = {},
): Promise<PlayersSyncSummary> {
  const summary = await withAdvisoryLock(LOCK_KEYS.players, () =>
    syncPlayersLocked(options),
  );
  return (
    summary ?? { locked: true, skipped: true, count: await countRows("players") }
  );
}

async function syncPlayersLocked(options: {
  force?: boolean;
}): Promise<PlayersSyncSummary> {
  if (!options.force && (await isFresh("players", PLAYERS_TTL_MS))) {
    return { locked: false, skipped: true, count: await countRows("players") };
  }

  const map = await getAllPlayers();
  const entries = Object.entries(map);

  await withTransaction((client) =>
    bulkInsert(client, {
      table: "players",
      columns: [
        "player_id",
        "first_name",
        "last_name",
        "full_name",
        "position",
        "team",
        "fantasy_positions",
        "status",
        "sport",
        "years_exp",
        "data",
      ],
      rows: entries,
      values: ([id, p]) => [
        id,
        p.first_name ?? null,
        p.last_name ?? null,
        p.full_name ?? null,
        p.position ?? null,
        p.team ?? null,
        j(p.fantasy_positions),
        p.status ?? null,
        p.sport ?? null,
        // Anything that isn't a number is stored as null rather than coerced:
        // Sleeper omits it for team defences and promises nothing about its
        // type, and null reads as "not known to be a rookie", which is the safe
        // side of the one question this column is asked.
        typeof p.years_exp === "number" && Number.isFinite(p.years_exp)
          ? p.years_exp
          : null,
        j(p),
      ],
      trailing: { column: "updated_at", sql: "now()" },
      // Upsert rather than replace: a player Sleeper drops from the map keeps
      // his row, which is what lets a 2019 trade still name him. The map is
      // Sleeper's *current* players, and the board is history.
      onConflict: `(player_id) DO UPDATE SET
          first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
          full_name = EXCLUDED.full_name, position = EXCLUDED.position,
          team = EXCLUDED.team, fantasy_positions = EXCLUDED.fantasy_positions,
          status = EXCLUDED.status, sport = EXCLUDED.sport,
          years_exp = EXCLUDED.years_exp,
          data = EXCLUDED.data, updated_at = now()`,
    }),
  );

  return { locked: false, skipped: false, count: entries.length };
}

/** Refresh the players map if it is stale; a no-op when fresh. */
export async function ensurePlayersFresh(): Promise<void> {
  await syncPlayers();
}
