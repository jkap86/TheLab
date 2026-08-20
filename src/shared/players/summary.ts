/**
 * What a stored player looks like to everything that draws one, and the one
 * place a `players` row becomes it.
 *
 * Pure and free of runtime imports, so the name fallback is testable — which is
 * the point of it being here rather than inline in `./queries`. Two reads now
 * resolve the same display fields ({@link getPlayersByIds} and
 * {@link getPlayersWithExperience}, the second being the first plus the column a
 * rookie class is named from), and a fallback written twice is two fallbacks: an
 * id showing up as a name on one route and a blank on another is exactly the
 * kind of drift nothing would fail on.
 */

/** A player resolved to a display name for rosters/picks UI. */
export type PlayerSummary = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
};

/** The `players` columns a summary is built from. */
export type PlayerNameRow = {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
};

/**
 * One row → one summary.
 *
 * The name is Sleeper's own `full_name` where it has one, the two halves joined
 * where it doesn't, and **the id where neither says anything** — a visible,
 * searchable token rather than an empty cell, which is what a caller can act on
 * when the players cache is behind Sleeper's map.
 */
export function toPlayerSummary(row: PlayerNameRow): PlayerSummary {
  const name =
    row.full_name ??
    ([row.first_name, row.last_name].filter(Boolean).join(" ") || row.player_id);
  return {
    player_id: row.player_id,
    name,
    position: row.position,
    team: row.team,
  };
}
