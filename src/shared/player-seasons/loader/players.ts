import { pool } from "@/shared/db";

import type { PlayerRecord } from "./facts.ts";

/**
 * The players map as the loader reads it: the identity and the three dated
 * fields a past season's facts are derived from.
 *
 * A read of its own rather than a widening of `players/queries`, on that
 * file's own line — the trades board resolves hundreds of ids per page and
 * renders none of this, so widening its statement would be four casts per row
 * for a page with nothing to do with them.
 *
 * **Every field lifted out of the raw blob is regex-guarded before its cast**,
 * the house rule `getMatchablePlayers` states: junk in an untyped blob must
 * read as "unknown", never fail the statement for every other player in it.
 *
 * **No draft position is read here, because the blob carries none.** It used
 * to be read off two paths a Sleeper blob "could plausibly carry one under",
 * and answered null on every one of twelve thousand rows — which the page then
 * printed as `UDFA`. Draft capital comes from `./draft-source` and is joined
 * to these records by Sleeper id in `./rows`.
 */
export async function readPlayerRecords(): Promise<Map<string, PlayerRecord>> {
  const { rows } = await pool.query<{
    player_id: string;
    name: string | null;
    position: string | null;
    birth_date: string | null;
    rookie_year: number | null;
    years_exp: number | null;
  }>(
    `SELECT player_id,
            coalesce(full_name, nullif(trim(concat_ws(' ', first_name, last_name)), '')) AS name,
            position,
            CASE WHEN data->>'birth_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                 THEN left(data->>'birth_date', 10) END AS birth_date,
            CASE WHEN data->'metadata'->>'rookie_year' ~ '^[0-9]{4}$'
                 THEN (data->'metadata'->>'rookie_year')::int END AS rookie_year,
            years_exp
       FROM players
      WHERE position IS NOT NULL`,
  );

  const map = new Map<string, PlayerRecord>();
  for (const row of rows) map.set(row.player_id, row);
  return map;
}
