// Relative with the extension, the pure→pure spelling: this module is tested
// under Node's runner, and the `@/shared/comps` barrel would drag `pg` in
// behind `pool.ts`.
import {
  COMPS_K_DEFAULT,
  COMPS_MIN_GAMES_DEFAULT,
} from "../../shared/comps/filters.ts";
import { defaultWeightsFor } from "../../shared/comps/fields.ts";

import type { CompsPosition } from "../../shared/comps/fields.ts";
import type { CompsBasis } from "../../shared/comps/filters.ts";

/**
 * The client's one author of `/api/comps`'s query string. One author is what
 * makes the cache key honest: two components spelling the same selection
 * differently would be two entries holding one answer.
 */

export type CompsSelection = {
  playerId: string;
  /** Explicit season, or null for the subject's latest stored one. */
  season: string | null;
  basis: CompsBasis;
  /** The subject's position — what the default board is resolved against. */
  position: CompsPosition;
  /** Weight per field key; a key absent or 0 is off. Null = untouched. */
  weights: Record<string, number> | null;
  k?: number;
  minGames?: number;
};

/**
 * The selection as a query string, with every default omitted — a bare
 * default board spells identically to one the reader tuned and reset by hand,
 * so the two land on one cache entry.
 */
export function buildCompsQuery(selection: CompsSelection): string {
  const params = new URLSearchParams();
  params.set("player_id", selection.playerId);
  if (selection.season !== null) params.set("season", selection.season);
  if (selection.basis !== "per_game") params.set("basis", selection.basis);

  const fields = explicitFields(selection);
  if (fields !== null) {
    params.set("fields", fields.map((f) => f.key).join(","));
    params.set("weights", fields.map((f) => f.weight).join(","));
  }

  const k = selection.k ?? COMPS_K_DEFAULT;
  if (k !== COMPS_K_DEFAULT) params.set("k", String(k));
  const minGames = selection.minGames ?? COMPS_MIN_GAMES_DEFAULT;
  if (minGames !== COMPS_MIN_GAMES_DEFAULT) {
    params.set("min_games", String(minGames));
  }

  return params.toString();
}

/**
 * The weights as the wire wants them — positive entries in catalogue-default
 * order — or null when they *are* the position's defaults, so the request
 * carries no `fields=` at all and shares the untouched board's cache entry.
 */
function explicitFields(
  selection: CompsSelection,
): { key: string; weight: number }[] | null {
  if (selection.weights === null) return null;

  const positive = Object.entries(selection.weights)
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => ({ key, weight }));

  const defaults = defaultWeightsFor(selection.position);
  const matchesDefaults =
    positive.length === defaults.length &&
    defaults.every(
      (d) => selection.weights?.[d.key] === d.weight,
    );
  if (matchesDefaults) return null;

  // Stable order for a stable cache key: the entries follow the object's own
  // insertion order, which the prefs codec fixes to catalogue order.
  return positive;
}
