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
 * Ids of every cached player at one of `positions` (Sleeper's spelling — "WR",
 * "DEF", "OLB").
 *
 * Exists so other modules can filter their own tables by position without
 * querying `players` themselves: `/api/projections` narrows a week this way,
 * since `projections` stores no position of its own. Returns an empty list for an
 * unknown position, which callers should read as "nothing matched".
 */
export async function getPlayerIdsByPosition(
  positions: string[],
): Promise<string[]> {
  if (positions.length === 0) return [];

  const { rows } = await pool.query<{ player_id: string }>(
    `SELECT player_id FROM players WHERE position = ANY($1)`,
    [positions],
  );
  return rows.map((r) => r.player_id);
}

/**
 * Player ids → the positions each is eligible at, Sleeper's `fantasy_positions`.
 *
 * Distinct from `position`, and the distinction is the whole reason this exists:
 * a lineup slot takes anyone eligible, so a back listed `["RB","WR"]` can fill a
 * `REC_FLEX` that his primary position would bar him from. Falls back to the
 * single position when Sleeper lists none, and omits an id the cache doesn't know
 * — a caller filling slots should treat that as "eligible for nothing" rather
 * than guess.
 */
export async function getFantasyPositions(
  ids: string[],
): Promise<Record<string, string[]>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<{
    player_id: string;
    positions: string[];
    position: string | null;
  }>(
    // Unnested in SQL so the driver hands back a text[]; `fantasy_positions` is
    // JSONB and Sleeper has been seen to store a non-array there, which
    // `jsonb_array_elements_text` errors on rather than skips.
    `SELECT player_id, position,
            ARRAY(SELECT jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(fantasy_positions) = 'array'
                         THEN fantasy_positions ELSE '[]'::jsonb END)) AS positions
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, string[]> = {};
  for (const r of rows) {
    out[r.player_id] =
      r.positions.length > 0 ? r.positions : r.position ? [r.position] : [];
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
