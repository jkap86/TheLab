import { compsField, defaultWeightsFor, isCompsPosition } from "./fields.ts";
import { fieldValue } from "./knn.ts";
import { compsDimensionKey, DEFAULT_COMPS_WINDOW } from "./windows.ts";

import type { CompsPosition } from "./fields.ts";
import type { CompsBasis, CompsWeightedField } from "./filters.ts";
import type { CompsFieldSpec, CompsPoolRow } from "./knn.ts";

/**
 * The route's decisions, minus the I/O — which season, which position gate,
 * which fields survive the subject — so each is a pure function a test can
 * drive, and the route is the thin composition the house rules ask for.
 */

/** A decision that can refuse, with a code the route maps onto a status. */
export type CompsRefusal = {
  ok: false;
  code: "COMPS_UNSUPPORTED_POSITION" | "COMPS_NO_SEASON" | "COMPS_NO_FIELDS";
  error: string;
};

/**
 * The market anchor for a season: `min(Sept 1 of the season, today)`.
 *
 * Every market read is taken *entering* that season — KTC as the latest
 * snapshot at or before this date, ADP over drafts started at or before it —
 * so a historical season's market numbers cannot leak information from after
 * the season began, and the current season's simply mean "as of now" while
 * September is still ahead. Today arrives as an argument, so the clamp is a
 * fact tests can pin rather than a read of the wall clock.
 */
export function compsSeasonAnchor(season: string, todayIso: string): string {
  const septFirst = `${season}-09-01`;
  return todayIso < septFirst ? todayIso : septFirst;
}

/**
 * Which season the subject means: the explicit one if it has stored stats,
 * else the latest season that does. `seasons` is the player's stored seasons
 * in any order; empty is the caller's 404 (the player has no stats at all),
 * decided before this is asked.
 */
export function resolveSubjectSeason(
  requested: string | null,
  seasons: readonly string[],
): { ok: true; season: string } | CompsRefusal {
  if (requested !== null) {
    if (!seasons.includes(requested)) {
      return {
        ok: false,
        code: "COMPS_NO_SEASON",
        error: `No stored stats for season ${requested}.`,
      };
    }
    return { ok: true, season: requested };
  }

  const latest = [...seasons].sort().at(-1);
  if (latest === undefined) {
    return {
      ok: false,
      code: "COMPS_NO_SEASON",
      error: "No stored stats for this player.",
    };
  }
  return { ok: true, season: latest };
}

/**
 * The subject-position gate. Normally unreachable — the picker only offers
 * supported positions — but a hand-built URL naming a kicker must be a
 * deterministic 400, never a silent all-positions comparison.
 */
export function resolveSubjectPosition(
  position: string | null,
): { ok: true; position: CompsPosition } | CompsRefusal {
  if (position === null || !isCompsPosition(position)) {
    return {
      ok: false,
      code: "COMPS_UNSUPPORTED_POSITION",
      error: `Comps supports QB, RB, WR and TE subjects; this player is ${position ?? "unknown"}.`,
    };
  }
  return { ok: true, position };
}

/**
 * What the comparison was *asked* for: the caller's explicit list, or the
 * position's defaults every one of which reads its own season.
 *
 * Split out of `resolveCompsFields` because the route needs it one step
 * earlier than it needs the resolution — the windows have to be materialized
 * onto the pool before the subject can be asked whether it answers them, and
 * the answer to "which windows" is exactly this list. One function, so the
 * dimensions materialized are by construction the dimensions resolved.
 */
export function compsWantedFields(
  explicit: CompsWeightedField[] | null,
  position: CompsPosition,
): CompsWeightedField[] {
  return (
    explicit ??
    defaultWeightsFor(position).map((field) => ({
      ...field,
      window: DEFAULT_COMPS_WINDOW,
    }))
  );
}

/**
 * The fields the comparison actually runs on: the caller's explicit list or
 * the position's defaults, minus any field the *subject* doesn't answer.
 *
 * A subject missing a weighted field — an unpriced player under a KTC weight,
 * a null birth date under age — drops the field and reports it
 * (`dropped_fields`), never a 400: the reader asked about the player, not the
 * field, and the honest answer is the comparison that can be made plus a note
 * about the part that couldn't. Only a subject answering *nothing* refuses.
 */
export function resolveCompsFields({
  explicit,
  position,
  subject,
  basis,
}: {
  explicit: CompsWeightedField[] | null;
  position: CompsPosition;
  subject: CompsPoolRow;
  basis: CompsBasis;
}): { ok: true; fields: CompsFieldSpec[]; dropped: string[] } | CompsRefusal {
  const wanted = compsWantedFields(explicit, position);

  const fields: CompsFieldSpec[] = [];
  const dropped: string[] = [];
  for (const { key, weight, window } of wanted) {
    const field = compsField(key);
    // The parser validated explicit keys and defaults come from the
    // catalogue, so an unknown key here is a programming error; skipping it
    // beats crashing on it.
    if (field === undefined) continue;
    const spec = {
      key: compsDimensionKey(key, window),
      weight,
      // A windowed value was materialized already resolved under the basis, so
      // the per-game divisor must not be applied a second time — its divisor
      // was the window's own games and this row's are the wrong ones.
      perGame: window === DEFAULT_COMPS_WINDOW && field.perGame,
    };
    if (fieldValue(subject, spec, basis) === null) {
      dropped.push(spec.key);
    } else {
      fields.push(spec);
    }
  }

  if (fields.length === 0) {
    return {
      ok: false,
      code: "COMPS_NO_FIELDS",
      error: "The subject answers none of the requested fields.",
    };
  }

  return { ok: true, fields, dropped };
}
