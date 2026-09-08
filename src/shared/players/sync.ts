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
 * chunks of {@link PLAYERS_BATCH} rows inside one transaction — so the peak is
 * that object plus one chunk's bound parameters rather than ~12k rows of SQL at
 * once. One transaction because a half-written map is a board that names some
 * players and not others.
 *
 * **And the object is iterated rather than copied.** This used to hand
 * `Object.entries(map)` to `bulkInsert`, which is a second full-size structure
 * beside the ~5MB parse: twelve thousand two-element arrays, every one of them
 * alive until the whole transaction finished, to carry a key that is already
 * the map's own. The ids are walked in place and a bounded batch of them is
 * what reaches the insert.
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
  let count = 0;

  await withTransaction(async (client) => {
    // One reused array of ids, refilled in place: the batch is the only thing
    // this holds beside the map itself, and `length = 0` keeps it the same
    // array rather than one per flush.
    const batch: string[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await writePlayers(client, map, batch);
      count += batch.length;
      batch.length = 0;
    };

    // `for…in` rather than `Object.keys`, which would be the twelve-thousand
    // element array this change exists to not build. The map is a parsed JSON
    // object, so its prototype carries nothing enumerable; the own-property
    // guard says so rather than relying on it.
    for (const id in map) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
      batch.push(id);
      if (batch.length >= PLAYERS_BATCH) await flush();
    }
    await flush();
  });

  return { locked: false, skipped: false, count };
}

/**
 * How many players one round trip carries.
 *
 * `bulkInsert` chunks at 500 of its own accord, so matching it means each batch
 * is exactly one statement and neither layer re-slices what the other built.
 */
const PLAYERS_BATCH = 500;

/** One batch of ids, read out of the map and written. */
function writePlayers(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  map: Awaited<ReturnType<typeof getAllPlayers>>,
  ids: readonly string[],
): Promise<void> {
  return bulkInsert(client, {
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
    rows: ids,
    values: (id) => {
      const p = map[id];
      return [
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
      ];
    },
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
  });
}

/** Refresh the players map if it is stale; a no-op when fresh. */
export async function ensurePlayersFresh(): Promise<void> {
  await syncPlayers();
}
