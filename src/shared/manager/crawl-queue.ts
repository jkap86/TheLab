import { pool } from "@/shared/db";

/*
 * The three stamps the manager sync writes on `leagues`, out of TheLabX's crawl
 * queue.
 *
 * That module is mostly the *reading* half — which leagues are due, which
 * managers are owed an enumeration, the single-statement claim that lets two
 * instances share a queue — and none of it has a caller until the crawler
 * ports. These three are the writing half, and the sync calls all of them
 * already. Kept under the crawl-queue name rather than folded into `persist.ts`
 * so that port extends this file instead of relocating what it finds here.
 */

/**
 * Record that somebody actually asked for these leagues.
 *
 * The crawler's one demand signal, and it is stamped only where demand is
 * *observed*: a manager's league sync means someone searched them. The crawler
 * deliberately does not stamp what it refreshes — within one rotation every
 * league would look demanded, which flattens the ordering back to the
 * round-robin it replaces.
 *
 * Best-effort by design: it is a scheduling hint, so a caller fires it off and
 * does not wait on it, and a failure costs a league its place in a queue rather
 * than costing the request its answer.
 */
export async function markLeaguesAccessed(
  leagueIds: readonly string[],
): Promise<void> {
  if (leagueIds.length === 0) return;
  await pool.query(
    `UPDATE leagues SET last_accessed_at = now()
      WHERE league_id = ANY($1::varchar[])`,
    [leagueIds],
  );
}

/**
 * Record that somebody tried to sync these leagues, whatever came of it.
 *
 * Stamped **before** the fetch: a probe that fails or is refused must still
 * rotate its league to the back of the queue, or the same handful hold the head
 * of it on every sync and the rest are never reached.
 */
export async function stampLeagueSyncAttempts(
  leagueIds: readonly string[],
): Promise<void> {
  if (leagueIds.length === 0) return;
  await pool.query(
    `UPDATE leagues SET sync_attempt_at = now()
      WHERE league_id = ANY($1::varchar[])`,
    [[...leagueIds]],
  );
}

/**
 * Tombstone leagues Sleeper no longer serves, so the refresh queue stops
 * claiming them: an unmarked deleted league is due forever — its `updated_at`
 * never advances — and would permanently burn a claim slot plus a Sleeper
 * request per rotation. The rows stay, and the marker is cleared by
 * `persistLeagueGraph` if a later sync finds the league alive again.
 */
export async function markLeaguesGone(leagueIds: string[]): Promise<void> {
  if (leagueIds.length === 0) return;
  await pool.query(
    `UPDATE leagues SET gone_at = now() WHERE league_id = ANY($1::varchar[])`,
    [leagueIds],
  );
}
