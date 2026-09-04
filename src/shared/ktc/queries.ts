import { pool } from "@/shared/db";

import { ktcPickKey, parseKtcPickName } from "./picks";
import type { KtcPickPrice } from "./picks";
import type { KtcFormat } from "./types";
import { foldKtcValues } from "./values";
import type { KtcValueSet } from "./values";

/**
 * Reads of `ktc_values`, the table this folder owns.
 *
 * Here rather than in the callers so nothing else writes SQL against it: a
 * roster is priced by asking `ktc` what its players are worth, the same way
 * `./match` takes the Sleeper side from `@/shared/players` rather than querying
 * `players` itself.
 *
 * **Both reads take a format, and every one of them must.** `ktc_values` is
 * keyed `(format, ktc_id)`: a dynasty row and a redraft row are two markets,
 * not two readings of one, and an unscoped read would answer with whichever
 * happened to sort first. Which format a league reads is `resolveKtcFormat`'s
 * answer, one layer up — this file only ever does what it is told.
 *
 * These are *uncached*; `./board-read` is the memo in front of them, on
 * `projections/ros-read`'s terms. Callers should reach for that.
 */

/**
 * One market's whole player board, keyed by Sleeper id.
 *
 * **The board rather than `getKtcValuesBySleeperId(ids)`**, which is what
 * TheLabX asks for because it prices one league at a time. The manager page
 * prices every roster in every league it lists, so the id list is *larger* than
 * the board — around 500 rows priced against a few thousand distinct players —
 * and binding those ids would be a bigger query returning a smaller answer.
 * `./board-read` then holds it for a TTL, which is what makes the read once per
 * fifteen minutes rather than once per request.
 *
 * Pick rows are excluded by the `sleeper_id IS NOT NULL` predicate rather than
 * by naming their position: a pick is not a player anywhere in Sleeper's map,
 * so the matcher leaves its id null by construction. {@link getKtcPickBoard} is
 * the read that can see them.
 *
 * Two rows resolving to one Sleeper id is legitimate rather than corruption —
 * the match is name-based — so the rows are folded through
 * {@link foldKtcValues}, which resolves the two QB boards **independently**.
 * There is no `ORDER BY`: the ordered `DISTINCT ON` this replaces was doing the
 * choosing, and a sort that decides nothing is a sort worth not asking for.
 */
export async function getKtcBoard(format: KtcFormat): Promise<KtcValueSet> {
  const { rows } = await pool.query<{
    sleeper_id: string;
    sf_value: number | null;
    oneqb_value: number | null;
    updated_at: Date;
  }>(
    `SELECT sleeper_id, sf_value, oneqb_value, updated_at
       FROM ktc_values
      WHERE format = $1
        AND sleeper_id IS NOT NULL`,
    [format],
  );

  return foldKtcValues(rows);
}

/** KTC's pick rows, keyed by {@link ktcPickKey} — see {@link getKtcPickBoard}. */
export type KtcPickBoard = Record<string, KtcPickPrice>;

/**
 * Every rookie-pick row a market currently prices, keyed the way a stored pick
 * is looked up.
 *
 * **Its own read rather than a case of {@link getKtcBoard}, because a pick has
 * no `sleeper_id`.** The matcher resolves KTC entries to Sleeper players by
 * name, and a pick is not a player, so every one of these rows carries a null
 * id and is invisible to the lookup every other surface uses. That is why the
 * board's picks went unread for as long as they did: nothing was excluding
 * them, nothing could reach them.
 *
 * The whole board is one query and a few dozen rows — the dynasty market prices
 * three seasons of four rounds in three tiers, 36 rows as this landed, and the
 * redraft market has no picks at all, which is right and is why a redraft
 * league's pick metric ranks null rather than zero. So it is read whole and
 * narrowed by the caller rather than asked about a key at a time. Rows whose
 * name doesn't parse are dropped rather than guessed at (see
 * {@link parseKtcPickName}), and a name that somehow appears twice keeps its
 * first row, ordered by `ktc_id` so which one that is doesn't move between
 * reads.
 */
export async function getKtcPickBoard(
  format: KtcFormat,
): Promise<KtcPickBoard> {
  const { rows } = await pool.query<{
    player_name: string | null;
    sf_value: number | null;
    oneqb_value: number | null;
  }>(
    `SELECT player_name, sf_value, oneqb_value
       FROM ktc_values
      WHERE format = $1
        AND position = 'RDP'
        AND (sf_value IS NOT NULL OR oneqb_value IS NOT NULL)
      ORDER BY ktc_id`,
    [format],
  );

  const board: KtcPickBoard = {};
  for (const row of rows) {
    const parsed = parseKtcPickName(row.player_name ?? "");
    if (!parsed) continue;
    const key = ktcPickKey(parsed.season, parsed.round, parsed.tier);
    if (key in board) continue;
    board[key] = { sf: row.sf_value, oneqb: row.oneqb_value };
  }

  // Rows stored and none of them understood is what a KTC rename looks like
  // from here, and it is otherwise silent: every pick on every card simply
  // stops carrying a price, which reads as picks being unpriced rather than as
  // the parser having gone deaf. Said once per cache TTL, not per read.
  if (rows.length > 0 && Object.keys(board).length === 0) {
    console.warn(
      `[ktc] ${rows.length} ${format} pick row(s) stored and none parsed — ` +
        `KTC may have renamed them (e.g. "${rows[0].player_name}").`,
    );
  }
  return board;
}
