import type { PoolClient } from "pg";

import {
  bulkInsert,
  LOCK_KEYS,
  msInterval,
  pool,
  withAdvisoryLock,
  withTransaction,
} from "@/shared/db";
import { errorMessage } from "@/shared/util";

import { fetchKtcPlayerHistory } from "./client";
import { int } from "./parse";
import type { KtcHistoryPoint, KtcPlayer } from "./types";

/**
 * Players whose full history is scraped per backfill tick. Player pages are
 * 3–6MB each and the scheduler ticks every 15 minutes, so 5 walks the whole
 * ~500-entry board in about a day and then goes mostly idle (the TTL gate below
 * leaves nothing to do on most ticks).
 */
export const KTC_HISTORY_BATCH = 5;

/**
 * How long a player's scraped history stays fresh. Long, because the daily
 * snapshot already keeps every player current going forward — re-scraping only
 * repairs gaps (days the server was down) and picks up KTC's own revisions.
 */
export const KTC_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const HISTORY_COLUMNS = [
  "ktc_id", "date", "sf_value", "sf_rank", "sf_position_rank",
  "oneqb_value", "oneqb_rank", "oneqb_position_rank",
];

/**
 * The per-day series is the same data as `ktc_values`, just older; a re-scrape
 * is authoritative over whatever is already stored for that day.
 */
const HISTORY_ON_CONFLICT = `(ktc_id, date) DO UPDATE SET
    sf_value = EXCLUDED.sf_value, sf_rank = EXCLUDED.sf_rank,
    sf_position_rank = EXCLUDED.sf_position_rank,
    oneqb_value = EXCLUDED.oneqb_value, oneqb_rank = EXCLUDED.oneqb_rank,
    oneqb_position_rank = EXCLUDED.oneqb_position_rank`;

/**
 * Today's date on KTC's clock. Their series roll over on US Eastern days, so
 * stamping snapshots with the server's local (or UTC) date would file a late
 * evening scrape under tomorrow.
 */
function ktcToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Record today's value/rank for every player on the rankings page.
 *
 * Called from `syncKtcValues` with its transaction client, so the snapshot and
 * the `ktc_values` upsert land together — it costs no extra requests and keeps
 * history moving forward for players the slow backfill hasn't reached.
 */
export async function recordDailySnapshot(
  client: PoolClient,
  players: readonly KtcPlayer[],
): Promise<number> {
  const date = ktcToday();
  const rows = players.filter((p) => typeof p.playerID === "number");

  await bulkInsert(client, {
    table: "ktc_value_history",
    columns: HISTORY_COLUMNS,
    rows,
    values: (p) => [
      int(p.playerID), date,
      int(p.superflexValues?.value), int(p.superflexValues?.rank),
      int(p.superflexValues?.positionalRank),
      int(p.oneQBValues?.value), int(p.oneQBValues?.rank),
      int(p.oneQBValues?.positionalRank),
    ],
    onConflict: HISTORY_ON_CONFLICT,
  });

  return rows.length;
}

/** Upsert one player's full scraped series. */
function writePlayerHistory(
  ktcId: number,
  points: readonly KtcHistoryPoint[],
): Promise<void> {
  return withTransaction(async (client) => {
    await bulkInsert(client, {
      table: "ktc_value_history",
      columns: HISTORY_COLUMNS,
      rows: points,
      values: (p) => [
        ktcId, p.date, p.sfValue, p.sfRank, p.sfPositionRank,
        p.oneqbValue, p.oneqbRank, p.oneqbPositionRank,
      ],
      onConflict: HISTORY_ON_CONFLICT,
    });
    await client.query(
      `UPDATE ktc_values
          SET history_synced_at = now(), history_attempt_at = now()
        WHERE ktc_id = $1`,
      [ktcId],
    );
  });
}

type PendingRow = { ktc_id: number; slug: string; player_name: string };

/** Players due a history scrape, most-valuable first within the stalest tier. */
async function pendingPlayers(
  limit: number,
  force: boolean,
): Promise<{ rows: PendingRow[]; remaining: number }> {
  const staleGate = force
    ? "TRUE"
    : `(history_synced_at IS NULL
         OR history_synced_at < now() - $1::interval)`;
  const gateParams = force ? [] : [msInterval(KTC_HISTORY_TTL_MS)];

  // `history_attempt_at` orders the queue (not `history_synced_at`) so a player
  // whose page keeps failing rotates to the back instead of being retried every
  // tick ahead of everyone else.
  const { rows } = await pool.query<PendingRow>(
    `SELECT ktc_id, slug, player_name
       FROM ktc_values
      WHERE slug IS NOT NULL AND ${staleGate}
      ORDER BY history_attempt_at ASC NULLS FIRST,
               sf_value DESC NULLS LAST
      LIMIT $${gateParams.length + 1}`,
    [...gateParams, Math.max(0, Math.trunc(limit))],
  );

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM ktc_values
      WHERE slug IS NOT NULL AND ${staleGate}`,
    gateParams,
  );

  return { rows, remaining: Number(countRows[0].count) };
}

export type KtcHistorySummary = {
  /** true when another instance held the lock and this run did nothing. */
  locked: boolean;
  /** Players whose page was scraped and stored successfully. */
  scraped: number;
  /** Players whose scrape failed (logged, retried on a later tick). */
  failed: number;
  /** Day rows upserted across all scraped players. */
  rows: number;
  /** Players still due a scrape after this batch (including the failures). */
  remaining: number;
};

/**
 * Backfill full KTC value history for a batch of players.
 *
 * Deliberately incremental and sequential: each player page is megabytes, so a
 * few per tick keeps the load on KTC (and this process) modest while the corpus
 * fills in over a day. One player's failure never aborts the batch — the
 * attempt is stamped so the queue rotates past them, and they come back around
 * on a later tick.
 *
 * Held under an advisory lock: unlike the league crawler's queue, this one
 * selects its batch without atomically claiming it, so two instances running at
 * once would pick the same players and scrape those multi-megabyte pages twice.
 */
export async function syncKtcHistory(
  options: { limit?: number; force?: boolean } = {},
): Promise<KtcHistorySummary> {
  const { limit = KTC_HISTORY_BATCH, force = false } = options;

  const summary = await withAdvisoryLock(LOCK_KEYS.ktcHistory, async () => {
    const { rows: pending, remaining } = await pendingPlayers(limit, force);

    let scraped = 0;
    let failed = 0;
    let rows = 0;

    for (const player of pending) {
      try {
        const points = await fetchKtcPlayerHistory(player.slug);
        await writePlayerHistory(player.ktc_id, points);
        scraped++;
        rows += points.length;
      } catch (error) {
        failed++;
        await pool
          .query(`UPDATE ktc_values SET history_attempt_at = now() WHERE ktc_id = $1`, [
            player.ktc_id,
          ])
          .catch(() => {});
        console.warn(
          `[ktc] History scrape failed for ${player.player_name} (${player.slug}):`,
          errorMessage(error),
        );
      }
    }

    return { locked: false, scraped, failed, rows, remaining: remaining - scraped };
  });

  return summary ?? { locked: true, scraped: 0, failed: 0, rows: 0, remaining: 0 };
}
