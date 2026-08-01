import {
  bulkInsert,
  countRows,
  isFresh,
  jsonb as j,
  LOCK_KEYS,
  withAdvisoryLock,
  withTransaction,
} from "@/shared/db";
import { ensurePlayersFresh, getMatchablePlayers } from "@/shared/players";

import { fetchKtcDynastyRankings } from "./client";
import { recordDailySnapshot } from "./history";
import { resolveSleeperIds } from "./match";
import { int } from "./parse";
import { countPricedKtcValues } from "./queries";
import { validateKtcBoard } from "./validate";

/** How long scraped KTC values stay fresh; matches the 15-min refresh cadence. */
export const KTC_TTL_MS = 15 * 60 * 1000;

export type KtcSyncSummary = {
  /** true when another instance held the lock and this run did nothing. */
  locked: boolean;
  /** true when no scrape happened — either locked out, or the cache was fresh. */
  skipped: boolean;
  count: number;
  /**
   * Why a scrape was refused, or null when it wasn't. A rejected scrape writes
   * nothing and advances no timestamp, so the stored board stays exactly as it
   * was — see `./validate`.
   */
  rejected: string | null;
};

/**
 * Scrape KeepTradeCut dynasty values and upsert them into `ktc_values`, plus
 * today's row per player into `ktc_value_history`. Skips the scrape when the
 * cache is still fresh unless `force` is set. Upserts in chunks inside one
 * transaction so readers never observe a partial set.
 *
 * Held under an advisory lock so extra app instances sharing one database don't
 * scrape KTC concurrently; the freshness gate runs inside it, so whichever
 * instance wins the lock is the one that decides whether a refresh is needed.
 */
export async function syncKtcValues(
  options: { force?: boolean } = {},
): Promise<KtcSyncSummary> {
  const summary = await withAdvisoryLock(LOCK_KEYS.ktcValues, async () => {
    if (!options.force && (await isFresh("ktc_values", KTC_TTL_MS))) {
      return {
        locked: false,
        skipped: true,
        count: await countRows("ktc_values"),
        rejected: null,
      };
    }

    // Completeness gate. A junk playerID would put a null into the table's
    // integer primary key and fail the whole transaction; a *fragment* would do
    // something worse and quieter — pass the old non-empty check, then null the
    // ~480 players it omits. `validateKtcBoard` filters and judges in one pass,
    // before the transaction opens, so a refusal touches nothing at all.
    const scraped = await fetchKtcDynastyRankings();
    const previous = await countPricedKtcValues();
    const validation = validateKtcBoard(scraped, previous);

    if (!validation.ok) {
      console.error(
        `[ktc] Refused a suspicious board: ${validation.reason} ` +
          `(previous=${validation.previous} valid=${validation.valid} ` +
          `rejected=${validation.rejected} scraped=${scraped.length}). ` +
          `Stored values left untouched.`,
      );
      return {
        locked: false,
        skipped: true,
        count: previous,
        rejected: validation.reason,
      };
    }

    const players = validation.players;
    if (validation.rejected > 0) {
      console.warn(
        `[ktc] Dropped ${validation.rejected} invalid/duplicate entr(ies) of ` +
          `${scraped.length} scraped.`,
      );
    }

    // Resolve KTC entries to Sleeper player_ids from the cached players map.
    // Best-effort: make sure that cache exists first, but never let a players
    // refresh failure block KTC values from updating (ids just stay null).
    try {
      await ensurePlayersFresh();
    } catch (error) {
      console.warn("[ktc] Players cache refresh failed; sleeper_id may be null:", error);
    }
    const sleeperIds = resolveSleeperIds(players, await getMatchablePlayers());

    await withTransaction(async (client) => {
      await bulkInsert(client, {
        table: "ktc_values",
        columns: [
          "ktc_id", "sleeper_id", "player_name", "slug", "position", "team",
          "rookie", "age", "sf_value", "sf_rank", "sf_position_rank",
          "oneqb_value", "oneqb_rank", "oneqb_position_rank", "data",
        ],
        rows: players,
        values: (p) => [
          int(p.playerID), sleeperIds.get(p.playerID) ?? null,
          p.playerName ?? null, p.slug ?? null, p.position ?? null,
          p.team || null, Boolean(p.rookie),
          typeof p.age === "number" ? p.age : null,
          int(p.superflexValues?.value), int(p.superflexValues?.rank),
          int(p.superflexValues?.positionalRank),
          int(p.oneQBValues?.value), int(p.oneQBValues?.rank),
          int(p.oneQBValues?.positionalRank), j(p),
        ],
        trailing: { column: "updated_at", sql: "now()" },
        onConflict: `(ktc_id) DO UPDATE SET
            sleeper_id = EXCLUDED.sleeper_id, player_name = EXCLUDED.player_name,
            slug = EXCLUDED.slug, position = EXCLUDED.position,
            team = EXCLUDED.team, rookie = EXCLUDED.rookie, age = EXCLUDED.age,
            sf_value = EXCLUDED.sf_value, sf_rank = EXCLUDED.sf_rank,
            sf_position_rank = EXCLUDED.sf_position_rank,
            oneqb_value = EXCLUDED.oneqb_value, oneqb_rank = EXCLUDED.oneqb_rank,
            oneqb_position_rank = EXCLUDED.oneqb_position_rank,
            data = EXCLUDED.data, updated_at = now()`,
      });
      // KTC's board is a churning top-~500, so a refresh can shrink: a player
      // who fell off would otherwise keep his last price forever and quietly
      // read as current. Null the values (rather than delete the row — history
      // FKs it with ON DELETE CASCADE) inside the same transaction. The real
      // guard is `validateKtcBoard` above, which refuses a fragment before this
      // transaction opens; the non-empty check stays as the last line of
      // defence, since this statement is the one that does the damage.
      if (players.length > 0) {
        await client.query(
          `UPDATE ktc_values
              SET sf_value = NULL, sf_rank = NULL, sf_position_rank = NULL,
                  oneqb_value = NULL, oneqb_rank = NULL,
                  oneqb_position_rank = NULL, updated_at = now()
            WHERE ktc_id <> ALL($1::int[])
              AND (sf_value IS NOT NULL OR oneqb_value IS NOT NULL)`,
          [players.map((p) => p.playerID)],
        );
      }
      // Same transaction, and after the upsert above so every ktc_id the
      // snapshot references already exists (ktc_value_history FKs ktc_values).
      await recordDailySnapshot(client, players);
    });

    return {
      locked: false, skipped: false, count: players.length, rejected: null,
    };
  });

  return summary ?? { locked: true, skipped: true, count: 0, rejected: null };
}
