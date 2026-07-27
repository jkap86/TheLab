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
 * over all of it; there is nothing to filter by up front.
 */
export async function getMatchablePlayers(): Promise<MatchablePlayer[]> {
  const { rows } = await pool.query<MatchablePlayer>(
    `SELECT player_id, full_name, first_name, last_name, position, team,
            (data->>'active')::boolean AS active,
            NULLIF(left(data->>'birth_date', 4), '')::int AS birth_year
       FROM players
      WHERE position IS NOT NULL`,
  );
  return rows;
}
