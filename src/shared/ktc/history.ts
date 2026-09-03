import type { PoolClient } from "pg";

import { bulkInsert, LOCK_KEYS, pool, withAdvisoryLock, withTransaction } from "@/shared/db";
import { easternDate, errorMessage, mapWithConcurrency } from "@/shared/util";

import { fetchKtcPlayerHistory } from "./client";
import { int } from "./parse";
import type { KtcFormat, KtcHistoryPoint, KtcPlayer } from "./types";

/**
 * The two writers of `ktc_value_history`: the daily snapshot the values sync
 * records for free, and the per-player backfill that runs once at boot.
 */

/**
 * Players per lock acquisition. The drain re-acquires the advisory lock and
 * re-selects the queue per batch rather than holding both for the whole run:
 * `withAdvisoryLock` parks its session connection for the duration of `fn`,
 * and a ~30-minute hold would be one of the pool's ten connections gone for
 * the whole backfill. Re-selecting each time is also what lets two instances
 * interleave without scraping the same multi-megabyte page twice.
 */
export const KTC_HISTORY_BATCH = 10;

/** Pages in flight at once during the backfill. */
export const KTC_HISTORY_CONCURRENCY = 2;

/**
 * Pause after each player page, per worker. With two workers this paces the
 * ~870-page cold backfill to roughly half an hour — a crawl KTC can shrug off
 * rather than a burst it could reasonably read as an attack.
 */
export const KTC_HISTORY_DELAY_MS = 1_000;

const HISTORY_COLUMNS = [
  "format", "ktc_id", "date", "sf_value", "sf_rank", "sf_position_rank",
  "oneqb_value", "oneqb_rank", "oneqb_position_rank",
];

/**
 * The per-day series is the same data as `ktc_values`, just older; a re-scrape
 * is authoritative over whatever is already stored for that day.
 */
const HISTORY_ON_CONFLICT = `(format, ktc_id, date) DO UPDATE SET
    sf_value = EXCLUDED.sf_value, sf_rank = EXCLUDED.sf_rank,
    sf_position_rank = EXCLUDED.sf_position_rank,
    oneqb_value = EXCLUDED.oneqb_value, oneqb_rank = EXCLUDED.oneqb_rank,
    oneqb_position_rank = EXCLUDED.oneqb_position_rank`;

/**
 * Today's date on KTC's clock. Their series roll over on US Eastern days, so
 * stamping snapshots with the server's local (or UTC) date would file a late
 * evening scrape under tomorrow — and later collide with the authoritative
 * series when the backfill writes the same day under KTC's own date.
 *
 * The zone itself lives in `util/easternDate`, which the lineup checker's
 * day-lock is the second reader of: two spellings of "which day is it in New
 * York" is two chances for one of them to be the server's.
 */
const ktcToday = (): string => easternDate();

/**
 * Record today's value/rank for every entry on a board.
 *
 * Called from `syncKtcValues` with its transaction client — after the
 * `ktc_values` upsert, because these rows FK the ones it may just have created
 * — so the snapshot and the values land together. It costs no extra requests
 * and is what keeps history moving forward for players the boot backfill has
 * never seen.
 */
export async function recordDailySnapshot(
  client: PoolClient,
  format: KtcFormat,
  players: readonly KtcPlayer[],
): Promise<number> {
  const date = ktcToday();
  const rows = players.filter((p) => typeof p.playerID === "number");

  await bulkInsert(client, {
    table: "ktc_value_history",
    columns: HISTORY_COLUMNS,
    rows,
    values: (p) => [
      format, int(p.playerID), date,
      int(p.superflexValues?.value), int(p.superflexValues?.rank),
      int(p.superflexValues?.positionalRank),
      int(p.oneQBValues?.value), int(p.oneQBValues?.rank),
      int(p.oneQBValues?.positionalRank),
    ],
    onConflict: HISTORY_ON_CONFLICT,
  });

  return rows.length;
}

/** Upsert one player's full scraped series and stamp the row as synced. */
function writePlayerHistory(
  format: KtcFormat,
  ktcId: number,
  points: readonly KtcHistoryPoint[],
): Promise<void> {
  return withTransaction(async (client) => {
    await bulkInsert(client, {
      table: "ktc_value_history",
      columns: HISTORY_COLUMNS,
      rows: points,
      values: (p) => [
        format, ktcId, p.date, p.sfValue, p.sfRank, p.sfPositionRank,
        p.oneqbValue, p.oneqbRank, p.oneqbPositionRank,
      ],
      onConflict: HISTORY_ON_CONFLICT,
    });
    await client.query(
      `UPDATE ktc_values
          SET history_synced_at = now(), history_attempt_at = now()
        WHERE format = $1 AND ktc_id = $2`,
      [format, ktcId],
    );
  });
}

type PendingRow = {
  format: KtcFormat;
  ktc_id: number;
  slug: string;
  player_name: string;
};

const PENDING_SQL = `slug IS NOT NULL AND history_synced_at IS NULL`;

/**
 * Players still owed a history scrape, most-valuable first within the stalest
 * tier. `history_attempt_at` orders the queue (not `history_synced_at`) so a
 * player whose page keeps failing rotates to the back instead of being retried
 * at the head of every batch.
 */
async function pendingPlayers(limit: number): Promise<PendingRow[]> {
  const { rows } = await pool.query<PendingRow>(
    `SELECT format, ktc_id, slug, player_name
       FROM ktc_values
      WHERE ${PENDING_SQL}
      ORDER BY history_attempt_at ASC NULLS FIRST,
               sf_value DESC NULLS LAST
      LIMIT $1`,
    [Math.max(0, Math.trunc(limit))],
  );
  return rows;
}

async function pendingCount(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ktc_values WHERE ${PENDING_SQL}`,
  );
  return Number(rows[0].count);
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type KtcHistorySummary = {
  /** true when another instance held the lock and this drain stood down. */
  locked: boolean;
  /** Players whose page was scraped and stored successfully. */
  scraped: number;
  /** Players whose scrape failed (logged; retried next boot). */
  failed: number;
  /** Day rows upserted across all scraped players. */
  rows: number;
  /** Players still owed a series when the drain ended. */
  remaining: number;
};

/**
 * Drain the history backfill queue: every `ktc_values` row without a
 * `history_synced_at`, both formats mixed, until none remain.
 *
 * Runs **once, at boot** — TheLabX re-scrapes on a 30-day TTL, deliberately not
 * ported: the daily snapshot keeps every player current going forward, so a
 * re-scrape only repairs gaps and picks up KTC's own revisions, and "history on
 * boot" is this sync's brief. The cost to know about: a player who joins a
 * board mid-process accrues forward snapshots only, with no back-series until
 * the next boot. The queue predicate is also what makes the drain resumable —
 * a restart mid-backfill picks up exactly the players it never finished.
 *
 * A player's failure never aborts the drain: the attempt is stamped so the
 * queue rotates past them. What does end it early is a batch with no successes
 * at all — ten pages failing together means KTC is refusing us, and continuing
 * would hammer a site that has already said no. The next boot retries.
 */
export async function syncKtcHistory(): Promise<KtcHistorySummary> {
  let scraped = 0;
  let failed = 0;
  let rows = 0;

  for (;;) {
    const batch = await withAdvisoryLock(LOCK_KEYS.ktcHistory, async () => {
      const pending = await pendingPlayers(KTC_HISTORY_BATCH);
      let batchScraped = 0;
      let batchFailed = 0;
      let batchRows = 0;

      await mapWithConcurrency([...pending], KTC_HISTORY_CONCURRENCY, async (player) => {
        try {
          const points = await fetchKtcPlayerHistory(player.format, player.slug);
          await writePlayerHistory(player.format, player.ktc_id, points);
          batchScraped++;
          batchRows += points.length;
        } catch (error) {
          batchFailed++;
          await pool
            .query(
              `UPDATE ktc_values SET history_attempt_at = now()
                WHERE format = $1 AND ktc_id = $2`,
              [player.format, player.ktc_id],
            )
            .catch(() => {});
          console.warn(
            `[ktc] History scrape failed for ${player.player_name} ` +
              `(${player.format}/${player.slug}):`,
            errorMessage(error),
          );
        }
        await delay(KTC_HISTORY_DELAY_MS);
      });

      return {
        scraped: batchScraped,
        failed: batchFailed,
        rows: batchRows,
        done: pending.length < KTC_HISTORY_BATCH,
      };
    });

    // Another instance holds the lock mid-queue: the work is theirs now.
    if (batch === null) {
      return { locked: true, scraped, failed, rows, remaining: await pendingCount() };
    }

    scraped += batch.scraped;
    failed += batch.failed;
    rows += batch.rows;

    if (batch.done) break;
    if (batch.scraped === 0 && batch.failed > 0) {
      console.error(
        `[ktc] History backfill halted: a whole batch of ${batch.failed} failed. ` +
          `Retrying on the next boot.`,
      );
      break;
    }
  }

  return { locked: false, scraped, failed, rows, remaining: await pendingCount() };
}
