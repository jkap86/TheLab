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

/** How long the cached players map stays fresh (Sleeper: refresh once/day). */
export const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000;

export type PlayersSyncSummary = {
  /**
   * true when another instance held the lock and this run did nothing — the
   * same field KTC and projections carry. Without it a caller couldn't tell a
   * fresh-cache skip from someone else's in-flight download, which is the
   * difference between "nothing to do" and "try again shortly".
   */
  locked: boolean;
  skipped: boolean;
  count: number;
};

/**
 * Refresh the cached Sleeper players map. Skips the (large) download when the
 * cache is still fresh unless `force` is set. Upserts in chunks inside one
 * transaction.
 *
 * The advisory lock wraps the freshness check, not just the fetch — otherwise
 * every instance decides for itself that a refresh is due and they queue up to
 * download Sleeper's ~5MB map in turn, the one endpoint Sleeper asks be hit at
 * most once a day. A caller that loses the race treats the winner's run as its
 * own: the cache is being refreshed either way.
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

async function syncPlayersLocked(
  options: { force?: boolean },
): Promise<PlayersSyncSummary> {
  if (!options.force && (await isFresh("players", PLAYERS_TTL_MS))) {
    return { locked: false, skipped: true, count: await countRows("players") };
  }

  const map = await getAllPlayers();
  const entries = Object.entries(map);

  await withTransaction((client) =>
    bulkInsert(client, {
      table: "players",
      columns: [
        "player_id", "first_name", "last_name", "full_name", "position", "team",
        "fantasy_positions", "status", "sport", "years_exp", "data",
      ],
      rows: entries,
      values: ([id, p]) => [
        id, p.first_name ?? null, p.last_name ?? null, p.full_name ?? null,
        p.position ?? null, p.team ?? null, j(p.fantasy_positions),
        // Promoted out of `data` because the ADP board filters on it — see the
        // migration. Anything that isn't a number is stored as null rather than
        // coerced: Sleeper omits it for team defences and promises nothing about
        // its type, and a null reads as "not known to be a rookie", which is the
        // safe side of the one question this column is asked.
        p.status ?? null, p.sport ?? null,
        typeof p.years_exp === "number" && Number.isFinite(p.years_exp)
          ? p.years_exp
          : null,
        j(p),
      ],
      trailing: { column: "updated_at", sql: "now()" },
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

/** Refresh the players cache if it is stale; a no-op when fresh. */
export async function ensurePlayersFresh(): Promise<void> {
  await syncPlayers();
}
