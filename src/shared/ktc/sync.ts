import {
  bulkInsert,
  jsonb as j,
  LOCK_KEYS,
  pool,
  withAdvisoryLock,
  withTransaction,
} from "@/shared/db";
import { errorMessage } from "@/shared/util";

import { fetchKtcRankings } from "./client";
import { recordDailySnapshot } from "./history";
import { int } from "./parse";
import { validateKtcBoard } from "./validate";
import type { KtcFormat } from "./types";

/** How long scraped KTC values stay fresh; matches the 15-min refresh cadence. */
export const KTC_TTL_MS = 15 * 60 * 1000;

/**
 * Both formats, in sync order. A list rather than two calls so the loop, the
 * summary and any future caller stay exhaustive by construction.
 */
export const KTC_FORMATS: readonly KtcFormat[] = ["dynasty", "redraft"];

/** One format's outcome inside a {@link KtcSyncSummary}. */
export type KtcBoardSyncSummary = {
  format: KtcFormat;
  /** true when no write happened — fresh, refused, or failed. */
  skipped: boolean;
  /** Entries written, or currently priced when skipped. */
  count: number;
  /**
   * Why a scrape was refused by validation, or null. A refusal writes nothing
   * and advances no timestamp, so the stored board stays exactly as it was —
   * see `./validate`.
   */
  rejected: string | null;
  /** Why the board failed outright (fetch, parse, database), or null. */
  failed: string | null;
};

export type KtcSyncSummary = {
  /** true when another instance held the lock and this run did nothing. */
  locked: boolean;
  boards: KtcBoardSyncSummary[];
};

/**
 * Scrape both KeepTradeCut boards and upsert them into `ktc_values`, plus
 * today's row per entry into `ktc_value_history`. Skips a board whose stored
 * copy is still fresh unless `force` is set — the boot tick relies on that, so
 * a dev-loop restart doesn't re-scrape KTC every few minutes; interval ticks
 * force, because the interval equals the TTL and jitter would otherwise skip
 * whole cycles.
 *
 * The formats are synced sequentially and isolated: each has its own
 * validation, its own transaction and its own try/catch, so a dynasty outage
 * still syncs redraft. Held under one advisory lock so extra app instances
 * sharing a database don't scrape KTC concurrently; the freshness gate runs
 * inside it, so whichever instance wins the lock decides whether a refresh is
 * needed.
 */
export async function syncKtcValues(
  options: { force?: boolean } = {},
): Promise<KtcSyncSummary> {
  const summary = await withAdvisoryLock(LOCK_KEYS.ktcValues, async () => {
    const boards: KtcBoardSyncSummary[] = [];
    for (const format of KTC_FORMATS) {
      boards.push(await syncBoard(format, options.force ?? false));
    }
    return { locked: false, boards };
  });

  return summary ?? { locked: true, boards: [] };
}

/** A board's stored state: how many rows carry a price, and how stale they are. */
async function boardState(
  format: KtcFormat,
): Promise<{ priced: number; fresh: boolean }> {
  const { rows } = await pool.query<{ priced: string; updated_at: Date | null }>(
    `SELECT count(*) FILTER (WHERE sf_value IS NOT NULL OR oneqb_value IS NOT NULL)::text
              AS priced,
            max(updated_at) AS updated_at
       FROM ktc_values
      WHERE format = $1`,
    [format],
  );
  const updatedAt = rows[0].updated_at;
  return {
    priced: Number(rows[0].priced),
    fresh: updatedAt !== null && Date.now() - updatedAt.getTime() < KTC_TTL_MS,
  };
}

async function syncBoard(
  format: KtcFormat,
  force: boolean,
): Promise<KtcBoardSyncSummary> {
  try {
    const { priced, fresh } = await boardState(format);
    if (!force && fresh) {
      return { format, skipped: true, count: priced, rejected: null, failed: null };
    }

    // Completeness gate. A junk playerID would put a null into the table's
    // integer key and fail the whole transaction; a *fragment* would do
    // something worse and quieter — pass a bare non-empty check, then null the
    // hundreds of players it omits. `validateKtcBoard` filters and judges in
    // one pass, before the transaction opens, so a refusal touches nothing.
    // `priced` is this format's own count — judged against the other board's,
    // a first sync of the smaller one would read as a shrink.
    const scraped = await fetchKtcRankings(format);
    const validation = validateKtcBoard(format, scraped, priced);

    if (!validation.ok) {
      console.error(
        `[ktc] Refused a suspicious ${format} board: ${validation.reason} ` +
          `(previous=${validation.previous} valid=${validation.valid} ` +
          `rejected=${validation.rejected} scraped=${scraped.length}). ` +
          `Stored values left untouched.`,
      );
      return {
        format,
        skipped: true,
        count: priced,
        rejected: validation.reason,
        failed: null,
      };
    }

    const players = validation.players;
    if (validation.rejected > 0) {
      console.warn(
        `[ktc] Dropped ${validation.rejected} invalid/duplicate ${format} ` +
          `entr(ies) of ${scraped.length} scraped.`,
      );
    }

    await withTransaction(async (client) => {
      // `sleeper_id` is deliberately absent from both halves of the upsert: the
      // sync has nothing to say about it (the name matcher arrives with the
      // players table), and an EXCLUDED overwrite would erase the matcher's
      // backfilled ids on the next refresh.
      await bulkInsert(client, {
        table: "ktc_values",
        columns: [
          "format", "ktc_id", "player_name", "slug", "position", "team",
          "rookie", "age", "sf_value", "sf_rank", "sf_position_rank",
          "oneqb_value", "oneqb_rank", "oneqb_position_rank", "data",
        ],
        rows: players,
        values: (p) => [
          format, int(p.playerID),
          p.playerName ?? null, p.slug ?? null, p.position ?? null,
          p.team || null, Boolean(p.rookie),
          typeof p.age === "number" ? p.age : null,
          int(p.superflexValues?.value), int(p.superflexValues?.rank),
          int(p.superflexValues?.positionalRank),
          int(p.oneQBValues?.value), int(p.oneQBValues?.rank),
          int(p.oneQBValues?.positionalRank), j(p),
        ],
        trailing: { column: "updated_at", sql: "now()" },
        onConflict: `(format, ktc_id) DO UPDATE SET
            player_name = EXCLUDED.player_name, slug = EXCLUDED.slug,
            position = EXCLUDED.position, team = EXCLUDED.team,
            rookie = EXCLUDED.rookie, age = EXCLUDED.age,
            sf_value = EXCLUDED.sf_value, sf_rank = EXCLUDED.sf_rank,
            sf_position_rank = EXCLUDED.sf_position_rank,
            oneqb_value = EXCLUDED.oneqb_value, oneqb_rank = EXCLUDED.oneqb_rank,
            oneqb_position_rank = EXCLUDED.oneqb_position_rank,
            data = EXCLUDED.data, updated_at = now()`,
      });
      // A board is a churning top-N, so a refresh can shrink: a player who fell
      // off would otherwise keep his last price forever and quietly read as
      // current. Null the values (rather than delete the row — history FKs it
      // with ON DELETE CASCADE) inside the same transaction, **scoped to this
      // format** or each board's sync would null the other's. The real guard is
      // `validateKtcBoard` above, which refuses a fragment before this
      // transaction opens; the non-empty check stays as the last line of
      // defence, since this statement is the one that does the damage.
      if (players.length > 0) {
        await client.query(
          `UPDATE ktc_values
              SET sf_value = NULL, sf_rank = NULL, sf_position_rank = NULL,
                  oneqb_value = NULL, oneqb_rank = NULL,
                  oneqb_position_rank = NULL, updated_at = now()
            WHERE format = $1
              AND ktc_id <> ALL($2::int[])
              AND (sf_value IS NOT NULL OR oneqb_value IS NOT NULL)`,
          [format, players.map((p) => p.playerID)],
        );
      }
      // Same transaction, and after the upsert above so every (format, ktc_id)
      // the snapshot references already exists (ktc_value_history FKs ktc_values).
      await recordDailySnapshot(client, format, players);
    });

    return {
      format,
      skipped: false,
      count: players.length,
      rejected: null,
      failed: null,
    };
  } catch (error) {
    console.error(`[ktc] ${format} values sync failed:`, errorMessage(error));
    return {
      format,
      skipped: true,
      count: 0,
      rejected: null,
      failed: errorMessage(error, "sync failed"),
    };
  }
}
