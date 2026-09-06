import type { PoolClient } from "pg";

import {
  TRADE_PARTICIPANTS_ORPHAN_SQL,
  TRADE_PARTICIPANTS_PRUNE_SQL,
  tradeParticipantsRebuildSql,
} from "./sql";

/**
 * Keeping `trade_participants` in step with the trades and rosters it is
 * derived from — **without rewriting the history it also holds.**
 *
 * The thin I/O half of {@link tradeParticipantsRebuildSql} and the two
 * reconciling statements beside it, which is where the derivations live and are
 * tested; this file is three statements and a comment about when they run.
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
 * **It used to be `DELETE` then `INSERT`, and that was the historical
 * attribution bug.** The derivation reads `rosters.owner_id` as it stands now,
 * so wiping the league's rows and re-deriving them on every sync re-attributed
 * every past trade of any roster that had changed hands: manager A's October
 * trades became manager B's the first time B's ownership synced, in the circle,
 * in the managers menu, in the bay filter and on the card. The old comment here
 * named that as a *reason* the rebuild had to be wholesale. It was the reason it
 * could not be.
 *
 * So it is three statements, and each does one thing the others cannot:
 *
 * 1. **Upsert** ({@link tradeParticipantsRebuildSql}) — inserts rows for pairs
 *    not seen before, stamping the historical snapshot once, and refreshes
 *    today's owner on rows that already exist. Its conflict clause names
 *    neither `owner_id_at_trade` nor `owner_provenance`, so a repeated sync
 *    cannot move them; there is no branch for a later edit to flatten.
 * 2. **Prune** ({@link TRADE_PARTICIPANTS_PRUNE_SQL}) — drops rows the league's
 *    trades no longer name at all. Asked of `transactions` alone, so a roster
 *    that is merely orphaned today does not lose its history.
 * 3. **Orphan** ({@link TRADE_PARTICIPANTS_ORPHAN_SQL}) — nulls today's owner
 *    where nobody holds the roster, which is the one case with nothing to
 *    upsert from.
 *
 * **Still unconditional, and still over the stored transactions rather than the
 * graph in hand.** This sync re-fetched a window of weeks and the league's
 * earlier trades — which are most of them — are only in the table; and an owner
 * change still has to reach every row of the league, because `owner_id` is
 * about the present and moves for trades nobody touched. What is no longer
 * unconditional is the *history*, which is exactly the column that should never
 * have moved.
 *
 * The order matters in one place only: prune before the orphan pass, so the
 * update does not walk rows about to be deleted. The upsert is first because a
 * pair it inserts is by definition one the prune keeps.
 */
export async function rebuildTradeParticipants(
  client: PoolClient,
  leagueId: string,
): Promise<void> {
  await client.query(tradeParticipantsRebuildSql(` AND t.league_id = $1`), [
    leagueId,
  ]);
  await client.query(TRADE_PARTICIPANTS_PRUNE_SQL, [leagueId]);
  await client.query(TRADE_PARTICIPANTS_ORPHAN_SQL, [leagueId]);
}
