import type { PlayerSummary } from "@/shared/contract";

/**
 * The one place a `players` row becomes the shape everything that draws a
 * player holds.
 *
 * Pure apart from the type-only contract import, so the name fallback is
 * testable — which is the point of it being here rather than inline in
 * `./queries`. A fallback written twice is two fallbacks: an id showing up as a
 * name on one surface and a blank on another is exactly the kind of drift
 * nothing would fail on.
 *
 * {@link PlayerSummary} itself is declared in `shared/contract` rather than
 * here, because the trade card is a client module that names one and this
 * folder reaches Postgres.
 */

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
 * searchable token rather than an empty cell, which is what a reader can act on
 * when the stored map is behind Sleeper's.
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
