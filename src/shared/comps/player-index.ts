import { isCompsPosition } from "./fields.ts";

import type { CompsProfileInput } from "./assemble.ts";
import type { CompsPosition } from "./fields.ts";

/**
 * The picker's list, folded from the cheapest reads that can answer it — who
 * has stored stats, which seasons, and what the players cache calls them.
 *
 * **It used to be folded from the comps pools themselves**, which meant opening
 * the picker built the entire enriched corpus: every season's stat lines
 * assembled into rows, and a KTC snapshot, a KTC history aggregate, an ADP
 * average and the draft crosswalk behind each one — to print a name, a position
 * and a team. Nothing on this list is any of those things, so none of it is
 * read for it now: the seasons come off one `DISTINCT` over the stats table and
 * the labels off the players cache, which is the same source the pool's own
 * rows take them from.
 *
 * Pure, so what the list contains — and who it leaves out — is pinned by tests
 * rather than by the route that returns it.
 */

/** One `(player, season)` pair with stats stored, as the stats read answers. */
export type CompsPlayerSeasonRow = {
  player_id: string;
  season: string;
};

/**
 * One option in the picker. The wire shape (`CompsPlayerOptionPayload`) is this
 * type, aliased rather than redeclared — the client's list and the server's
 * fold must not be able to drift apart on a field name.
 */
export type CompsPlayerOption = {
  player_id: string;
  name: string;
  position: CompsPosition;
  /** Current team, as on every comps row. */
  team: string | null;
  /** The seasons this player has stored stats in, newest first. */
  seasons: string[];
};

/**
 * The index the picker draws: every player with stored stats at a supported
 * position, alphabetically, each with his seasons newest first.
 *
 * Three rules, each of which the pool-derived version kept and this one has to
 * keep on purpose:
 *
 * - **A player the profiles cache doesn't know is left out.** Unknown position
 *   is not an unsupported one, but the picker offers subjects, and a subject
 *   whose position can't be named is a 400 from `/api/comps` wearing a row in
 *   the list. Same for a supported-position filter: `COMPS_POSITIONS` is what
 *   keeps an unsupported subject a hand-built-URL case rather than something
 *   the UI can produce.
 * - **Seasons are newest first**, because the client reads the first as "his
 *   latest" — the season chips light index 0 when nothing is chosen, matching
 *   the server's own default of the latest stored season. Sorted here rather
 *   than trusted from the query, so the guarantee belongs to the fold.
 * - **Alphabetical by name**, for a stable payload; the client ranks by what
 *   was typed (`rankByName`) and doesn't depend on this order, but a list that
 *   comes back in a different order per request is a diff nobody can read.
 */
export function foldCompsPlayerIndex(
  rows: readonly CompsPlayerSeasonRow[],
  profiles: Record<string, CompsProfileInput>,
): CompsPlayerOption[] {
  const byPlayer = new Map<string, CompsPlayerOption>();

  for (const row of rows) {
    const seen = byPlayer.get(row.player_id);
    if (seen) {
      seen.seasons.push(row.season);
      continue;
    }
    const profile = profiles[row.player_id];
    const position = profile?.position ?? null;
    if (position === null || !isCompsPosition(position)) continue;
    byPlayer.set(row.player_id, {
      player_id: row.player_id,
      name: profile?.name ?? row.player_id,
      position,
      team: profile?.team ?? null,
      seasons: [row.season],
    });
  }

  const players = [...byPlayer.values()];
  for (const player of players) {
    player.seasons.sort((a, b) => b.localeCompare(a));
  }
  return players.sort((a, b) => a.name.localeCompare(b.name));
}
