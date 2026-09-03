import type { PlayerSummary } from "@/shared/contract";
import { pool } from "@/shared/db";

import { toPlayerSummary } from "./summary";
import type { PlayerNameRow } from "./summary";

/**
 * Reads over the stored players map.
 *
 * One for now — the trades board resolving a page's ids to names. TheLabX's
 * other five reads (the rookie class, the matchable set the KTC name matcher
 * walks, the search) arrive with the surfaces that ask them.
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
