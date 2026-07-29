import { pool } from "@/shared/db";

/**
 * Reads of `ktc_values`, the table this module owns.
 *
 * Here rather than in the callers so nothing else writes SQL against it: a
 * roster is priced by asking `ktc` what its players are worth, the same way
 * `ktc/match` stopped querying `players` directly.
 */

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
    // The sync replaces the whole table in one transaction, so these agree
    // today; taking the newest keeps that from being something to rely on.
    if (!newest || r.updated_at > newest) newest = r.updated_at;
  }

  return { values, updated_at: newest?.toISOString() ?? null };
}
