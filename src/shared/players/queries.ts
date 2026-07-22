import { pool } from "@/shared/db";

/** A player resolved to a display name for rosters/picks UI. */
export type PlayerSummary = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
};

type Row = {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
};

/**
 * Resolve player ids to names/position/team from the cache, keyed by id.
 * Missing ids are simply absent from the result.
 */
export async function getPlayersByIds(
  ids: string[],
): Promise<Record<string, PlayerSummary>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<Row>(
    `SELECT player_id, full_name, first_name, last_name, position, team
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, PlayerSummary> = {};
  for (const r of rows) {
    const name =
      r.full_name ??
      ([r.first_name, r.last_name].filter(Boolean).join(" ") || r.player_id);
    out[r.player_id] = {
      player_id: r.player_id,
      name,
      position: r.position,
      team: r.team,
    };
  }
  return out;
}
