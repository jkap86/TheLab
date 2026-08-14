import { pool } from "@/shared/db";

import { foldKtcSfHistory } from "./history-stats";
import type { KtcSfHistory, KtcSfHistoryRow } from "./history-stats";
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

/**
 * How far back an as-of read will reach for a snapshot. Wide enough to ride out
 * a gap in the daily series (the backfill exists because gaps happen), narrow
 * enough that the answer still means "KTC around that date" rather than a price
 * from a different part of the calendar.
 */
export const KTC_AS_OF_WINDOW_DAYS = 45;

/**
 * KTC values *as of a date*: per player, the latest `ktc_value_history`
 * snapshot at or before `anchorIso`, reaching back at most
 * {@link KTC_AS_OF_WINDOW_DAYS}.
 *
 * **Strictly backwards-looking, which is the point.** The comps pool anchors a
 * historical season's market read at that season's start; a
 * nearest-in-either-direction pick would quietly price "entering 2025" off an
 * October scrape — information from after the anchor wearing its date. A player
 * with no snapshot in the window is absent, which the caller reads as unknown
 * and never as zero.
 *
 * This is the first read against the history table the backfill has been
 * filling; `sleeper_id` rides on `ktc_values` (the match is per KTC entry, not
 * per day), and two KTC entries resolving to one Sleeper id go through
 * {@link foldKtcValues} exactly as the current-values read does — the
 * duplicate-resolution rule must not depend on which table the numbers came
 * from.
 */
export async function getKtcValuesAsOf(anchorIso: string): Promise<KtcValueSet> {
  const { rows } = await pool.query<KtcValueRow>(
    `SELECT DISTINCT ON (h.ktc_id)
            v.sleeper_id, h.sf_value, h.oneqb_value, h.date AS updated_at
       FROM ktc_value_history h
       JOIN ktc_values v USING (ktc_id)
      WHERE v.sleeper_id IS NOT NULL
        AND h.date <= $1::date
        AND h.date > $1::date - $2::int
      ORDER BY h.ktc_id, h.date DESC`,
    [anchorIso, KTC_AS_OF_WINDOW_DAYS],
  );

  return foldKtcValues(rows);
}

/**
 * How far apart the two endpoints of a trend read sit. Ninety days because the
 * question is "how was the market moving into this season" — long enough that
 * a camp battle or a breakout August registers as a slope rather than a blip,
 * short enough that the move is about *this* season and not the one before.
 */
export const KTC_TREND_WINDOW_DAYS = 90;

/**
 * The superflex history read behind the comps market fields: per player, the
 * career-peak value at or before `anchorIso` and the move over the
 * {@link KTC_TREND_WINDOW_DAYS} entering it.
 *
 * Strictly backwards-looking on every part, {@link getKtcValuesAsOf}'s own
 * rule: the peak scans everything up to the anchor and nothing after it, and
 * each trend endpoint is an as-of read with the same
 * {@link KTC_AS_OF_WINDOW_DAYS} lookback — so a gap in the daily series widens
 * to the nearest earlier snapshot and never to a later one. The peak's grain
 * drives the join (every entry with any history before the anchor), because a
 * player who has fallen off the board by the anchor still *has* a career high
 * — an as-of-driven join would erase exactly the faded players a peak field
 * exists to recognise. Duplicate entries resolving to one Sleeper id go
 * through {@link foldKtcSfHistory}, which is pure for the reason
 * `foldKtcValues` is.
 */
export async function getKtcSfHistoryAsOf(
  anchorIso: string,
): Promise<Record<string, KtcSfHistory>> {
  const { rows } = await pool.query<KtcSfHistoryRow>(
    `WITH peak AS (
       SELECT ktc_id, max(sf_value) AS sf_value
         FROM ktc_value_history
        WHERE sf_value IS NOT NULL AND date <= $1::date
        GROUP BY ktc_id
     ), asof AS (
       SELECT DISTINCT ON (ktc_id) ktc_id, sf_value
         FROM ktc_value_history
        WHERE sf_value IS NOT NULL
          AND date <= $1::date
          AND date > $1::date - $2::int
        ORDER BY ktc_id, date DESC
     ), prior AS (
       SELECT DISTINCT ON (ktc_id) ktc_id, sf_value
         FROM ktc_value_history
        WHERE sf_value IS NOT NULL
          AND date <= $1::date - $3::int
          AND date > $1::date - $3::int - $2::int
        ORDER BY ktc_id, date DESC
     )
     SELECT v.sleeper_id,
            peak.sf_value  AS peak_sf,
            asof.sf_value  AS asof_sf,
            prior.sf_value AS prior_sf
       FROM peak
       JOIN ktc_values v USING (ktc_id)
       LEFT JOIN asof USING (ktc_id)
       LEFT JOIN prior USING (ktc_id)
      WHERE v.sleeper_id IS NOT NULL`,
    [anchorIso, KTC_AS_OF_WINDOW_DAYS, KTC_TREND_WINDOW_DAYS],
  );

  return foldKtcSfHistory(rows);
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
