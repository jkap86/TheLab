import { pool } from "@/shared/db";

import { ktcPickKey, parseKtcPickName } from "./picks";
import type { KtcPickPrice } from "./picks";
import { foldKtcValues } from "./values";
import type { KtcValue, KtcValueRow, KtcValueSet } from "./values";

/**
 * Reads of `ktc_values`, the table this module owns.
 *
 * Here rather than in the callers so nothing else writes SQL against it: a
 * roster is priced by asking `ktc` what its players are worth, the same way
 * `ktc/match` stopped querying `players` directly.
 */

/**
 * How many stored players currently carry a price on either board.
 *
 * The population the completeness guard compares a fresh scrape against — not
 * `countRows`, which counts players whose values were nulled by an earlier
 * reconciliation too, and would make the board look bigger than it is. Zero is
 * a first sync.
 */
export async function countPricedKtcValues(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM ktc_values
      WHERE sf_value IS NOT NULL OR oneqb_value IS NOT NULL`,
  );
  return Number(rows[0].count);
}

// Re-exported from where every consumer already imports them: the shapes moved
// to `./values` with the duplicate resolution that produces them.
export type { KtcValue, KtcValueRow, KtcValueSet };

/**
 * Values for the Sleeper player ids given, keyed by id.
 *
 * `sleeper_id` is resolved by name matching at sync time and is null for draft
 * picks and anyone who didn't match, so this only ever answers for players KTC
 * both carries and could be tied to Sleeper — roughly the top 500 skill players.
 * Ids it can't answer for are simply absent.
 *
 * One entry per player even though `sleeper_id` carries no unique constraint —
 * the match is name-based, so two KTC entries resolving to one Sleeper id is
 * legitimate — and **the two boards are resolved independently**, which is the
 * part the SQL used to get wrong. It was `DISTINCT ON (sleeper_id) … ORDER BY
 * sf_value DESC`, so both numbers came off whichever row won on *superflex*: a
 * player with rows `(sf 9000, 1QB 5000)` and `(sf 8000, 1QB 7000)` was priced at
 * 5000 on the 1QB board with 7000 on file. See {@link foldKtcValues} for the
 * resolution and why it is a fold here rather than a `GROUP BY` in the query.
 *
 * The rows are therefore selected as they are and folded here, with no `ORDER BY`
 * at all — the one the `DISTINCT ON` needed was doing the choosing, and a sort
 * that no longer decides anything is a sort worth not asking for.
 */
export async function getKtcValuesBySleeperId(
  ids: string[],
): Promise<KtcValueSet> {
  if (ids.length === 0) return { values: {}, updated_at: null };

  const { rows } = await pool.query<KtcValueRow>(
    `SELECT sleeper_id, sf_value, oneqb_value, updated_at
       FROM ktc_values
      WHERE sleeper_id = ANY($1)`,
    [ids],
  );

  return foldKtcValues(rows);
}

/** KTC's pick rows, keyed by {@link ktcPickKey} — see {@link getKtcPickBoard}. */
export type KtcPickBoard = Record<string, KtcPickPrice>;

/**
 * Every rookie-pick row KTC currently prices, keyed the way a traded pick is
 * looked up.
 *
 * **Its own read rather than a case of {@link getKtcValuesBySleeperId}, because
 * a pick has no `sleeper_id`.** The matcher resolves KTC entries to Sleeper
 * players by name, and a pick is not a player anywhere in Sleeper's map, so
 * every one of these rows carries a null id and is invisible to the lookup every
 * other surface uses. That is why the board's picks went unread for as long as
 * they did: nothing was excluding them, nothing could reach them.
 *
 * The whole board is one query and a few dozen rows — KTC prices three or four
 * rounds across three or four seasons — so it is read whole and narrowed by the
 * caller, rather than asked about a key at a time. Rows whose name doesn't parse
 * are dropped rather than guessed at (see {@link parseKtcPickName}), and a name
 * that somehow appears twice keeps its first row, ordered by `ktc_id` so which
 * one that is doesn't move between reads.
 */
export async function getKtcPickBoard(): Promise<KtcPickBoard> {
  const { rows } = await pool.query<{
    player_name: string | null;
    sf_value: number | null;
    oneqb_value: number | null;
  }>(
    `SELECT player_name, sf_value, oneqb_value
       FROM ktc_values
      WHERE position = 'RDP'
        AND (sf_value IS NOT NULL OR oneqb_value IS NOT NULL)
      ORDER BY ktc_id`,
  );

  const board: KtcPickBoard = {};
  for (const row of rows) {
    const parsed = parseKtcPickName(row.player_name ?? "");
    if (!parsed) continue;
    const key = ktcPickKey(parsed.season, parsed.round, parsed.tier);
    if (key in board) continue;
    board[key] = { sf: row.sf_value, oneqb: row.oneqb_value };
  }

  // Rows stored and none of them understood is what a KTC rename looks like from
  // here, and it is otherwise silent: every pick on the trades board simply
  // stops carrying a price, which reads as picks being unpriced rather than as
  // the parser having gone deaf. Said once per cache TTL, not per read.
  if (rows.length > 0 && Object.keys(board).length === 0) {
    console.warn(
      `[ktc] ${rows.length} pick row(s) stored and none parsed — ` +
        `KTC may have renamed them (e.g. "${rows[0].player_name}").`,
    );
  }
  return board;
}
