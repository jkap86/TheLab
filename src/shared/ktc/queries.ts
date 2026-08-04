import { pool } from "@/shared/db";

import { ktcPickKey, parseKtcPickName } from "./picks";
import type { KtcPickPrice } from "./picks";

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

/** One player's value on both of KTC's boards; null where KTC prices neither. */
export type KtcValue = { sf: number | null; oneqb: number | null };

export type KtcValueSet = {
  /**
   * Sleeper player id → both board values. An id KTC doesn't price is absent
   * rather than zeroed — a kicker is off the board entirely, which is a
   * different claim from being worth nothing.
   */
  values: Record<string, KtcValue>;
  /**
   * When the rows behind those values were scraped, ISO 8601; null when none
   * matched. These are someone else's numbers on a fifteen-minute cache, so
   * anything showing them should be able to say how old they are — the same
   * reason `/api/projections` sends its own `updated_at`.
   */
  updated_at: string | null;
};

type Row = {
  sleeper_id: string;
  sf_value: number | null;
  oneqb_value: number | null;
  updated_at: Date;
};

/**
 * Values for the Sleeper player ids given, keyed by id.
 *
 * `sleeper_id` is resolved by name matching at sync time and is null for draft
 * picks and anyone who didn't match, so this only ever answers for players KTC
 * both carries and could be tied to Sleeper — roughly the top 500 skill players.
 * Ids it can't answer for are simply absent.
 *
 * One row per player even though `sleeper_id` carries no unique constraint: the
 * match is name-based, so two KTC entries resolving to one Sleeper id is
 * possible, and summing a roster twice for the same player is worse than picking
 * the higher of two prices deterministically.
 */
export async function getKtcValuesBySleeperId(
  ids: string[],
): Promise<KtcValueSet> {
  if (ids.length === 0) return { values: {}, updated_at: null };

  const { rows } = await pool.query<Row>(
    `SELECT DISTINCT ON (sleeper_id)
            sleeper_id, sf_value, oneqb_value, updated_at
       FROM ktc_values
      WHERE sleeper_id = ANY($1)
      ORDER BY sleeper_id, sf_value DESC NULLS LAST, ktc_id`,
    [ids],
  );

  const values: Record<string, KtcValue> = {};
  let newest: Date | null = null;
  for (const r of rows) {
    values[r.sleeper_id] = { sf: r.sf_value, oneqb: r.oneqb_value };
    // The sync upserts the board and nulls what fell off it, all in one
    // transaction, so every row it touched carries the same stamp; taking the
    // newest keeps that from being something to rely on.
    if (!newest || r.updated_at > newest) newest = r.updated_at;
  }

  return { values, updated_at: newest?.toISOString() ?? null };
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
