import type { PlayerSummary } from "@/shared/contract";
import { pool } from "@/shared/db";

import { toPlayerSummary } from "./summary";
import type { PlayerNameRow } from "./summary";

/**
 * Reads over the stored players map.
 *
 * Two — the trades board resolving a page's ids to names, and the matchable set
 * the KTC name matcher walks. TheLabX's other four (the rookie class, the
 * search, and its two comps reads) arrive with the surfaces that ask them.
 */

/**
 * Resolve player ids to names/position/team, keyed by id.
 *
 * **A missing id is simply absent**, never a placeholder row: the caller
 * already has the id in hand and knows what to draw without one, and inventing
 * an entry would make "the sync hasn't run" indistinguishable from "Sleeper has
 * no such player".
 */
export async function getPlayersByIds(
  ids: string[],
): Promise<Record<string, PlayerSummary>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<PlayerNameRow>(
    `SELECT player_id, full_name, first_name, last_name, position, team
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, PlayerSummary> = {};
  for (const r of rows) out[r.player_id] = toPlayerSummary(r);
  return out;
}

/**
 * A cached player projected down to the fields cross-source name matching needs
 * — see `@/shared/ktc`'s `resolveSleeperIds`. `active` and `birth_year` are
 * lifted out of the raw Sleeper payload so callers never have to know how that
 * blob is shaped.
 */
export type MatchablePlayer = {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  active: boolean | null;
  /** Year of birth, or null when Sleeper has no birth date on file. */
  birth_year: number | null;
};

/**
 * Every cached player that could be matched by name, i.e. has a position.
 *
 * Returns the whole table (~12k rows) because the caller builds lookup indexes
 * over all of it; there is nothing to filter by up front. Both lifted fields
 * are regex-guarded before their cast, the house rule for reading a number or
 * a boolean off a Sleeper blob: junk must read as "unknown", never fail the
 * query.
 */
export async function getMatchablePlayers(): Promise<MatchablePlayer[]> {
  const { rows } = await pool.query<MatchablePlayer>(
    `SELECT player_id, full_name, first_name, last_name, position, team,
            CASE WHEN data->>'active' IN ('true', 'false')
                 THEN (data->>'active')::boolean END AS active,
            CASE WHEN data->>'birth_date' ~ '^[0-9]{4}'
                 THEN left(data->>'birth_date', 4)::int END AS birth_year
       FROM players
      WHERE position IS NOT NULL`,
  );
  return rows;
}
