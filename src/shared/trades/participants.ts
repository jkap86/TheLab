import type { PoolClient } from "pg";

import { tradeParticipantsSql } from "./sql";

/**
 * Keeping `trade_participants` in step with the trades and rosters it is
 * derived from.
 *
 * The thin I/O half of {@link tradeParticipantsSql}, which is where the
 * derivation itself lives and is tested — this file is two statements and a
 * comment about when they run.
 */

/**
 * Rebuild one league's participant rows from what is stored for it.
 *
 * **Called inside `writeLeagueGraph`'s transaction, not after it.** This is not
 * a decoration: the reads **filter** on it, so a league whose
 * participants are missing is a league whose trades are invisible to the circle
 * that should have found them — a plausible wrong answer rather than a visibly
 * thinner one, which is the failure this codebase spends the most effort not
 * having. Committing with the rows it describes, or not at all, is the only
 * arrangement where that cannot happen.
 *
 * **Replaced wholesale rather than merged, and unconditionally.** Three reasons,
 * and the third is the one that rules out anything cleverer:
 *
 * - It is a *derivation*, so there is no upstream answer to be wrong about. The
 *   "guard the delete on a non-empty fetch" rule is about a collection Sleeper
 *   might have failed to send; these rows come from the same transaction's own
 *   committed writes, and a league that genuinely trades nothing genuinely has
 *   none.
 * - It is small. One `league_id` is one season of one league, so a few dozen
 *   trades and a couple of hundred rows — the same order as the `traded_picks`
 *   and `league_users` replacements a few statements above it.
 * - **An owner change rewrites rows no new trade touched.** The mapping reads
 *   `rosters.owner_id` as it stands now, so a manager taking over a roster
 *   changes the attribution of every trade that roster was ever in. An
 *   incremental rebuild over the weeks this sync re-fetched would miss exactly
 *   that, and miss it silently.
 *
 * It reads the *stored* transactions rather than the graph in hand for the same
 * reason: this sync re-fetched a window of weeks, and the league's earlier
 * trades — which are most of them — are only in the table.
 */
export async function rebuildTradeParticipants(
  client: PoolClient,
  leagueId: string,
): Promise<void> {
  await client.query(`DELETE FROM trade_participants WHERE league_id = $1`, [
    leagueId,
  ]);
  await client.query(
    `INSERT INTO trade_participants (transaction_id, league_id, roster_id, owner_id)
     ${tradeParticipantsSql(` AND t.league_id = $1`)}`,
    [leagueId],
  );
}
