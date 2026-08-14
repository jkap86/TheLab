// Relative pure→pure imports: this codec is tested under Node's runner.
import { COMPS_FIELDS, defaultWeightsFor, isCompsPosition } from "../../shared/comps/fields.ts";

import type { CompsPosition } from "../../shared/comps/fields.ts";
import type { CompsBasis } from "../../shared/comps/filters.ts";

/**
 * What the comps tool remembers on the device, and the codec that keeps a
 * stored copy honest across builds. The storage itself is `local-store.ts`;
 * this module is the parse/serialize half, pure and tested.
 *
 * **Weights are kept per position.** A board tuned for receivers must not
 * follow the reader onto a quarterback — the fields that matter are different
 * fields — so customizing writes only the subject position's entry, and every
 * other position keeps opening on the catalogue's defaults.
 */

export type CompsPrefs = {
  basis: CompsBasis;
  /** Full weight boards, keyed by position; a position absent is untouched. */
  weightsByPosition: Partial<Record<CompsPosition, Record<string, number>>>;
};

export const COMPS_PREFS_KEY = "comps-prefs";

/** Bump when the stored shape changes; an old version reads as defaults. */
export const COMPS_PREFS_VERSION = 1;

export const DEFAULT_COMPS_PREFS: CompsPrefs = {
  basis: "per_game",
  weightsByPosition: {},
};

/**
 * The full board a position opens with: every catalogue field, at its default
 * weight for the position or 0. Catalogue order, which is what fixes the
 * object's insertion order — and through it the wire spelling's field order.
 */
export function defaultWeightBoard(
  position: CompsPosition,
): Record<string, number> {
  const defaults = new Map(
    defaultWeightsFor(position).map((d) => [d.key, d.weight]),
  );
  const board: Record<string, number> = {};
  for (const field of COMPS_FIELDS) {
    board[field.key] = defaults.get(field.key) ?? 0;
  }
  return board;
}

/**
 * The board to open for a position: the stored one if the reader customized
 * it, the catalogue's otherwise. A stored board is re-laid onto the catalogue
 * on the way out, so a field added since the write appears at 0 and one
 * removed since simply stops existing.
 */
export function weightsFor(
  prefs: CompsPrefs,
  position: CompsPosition,
): Record<string, number> {
  const stored = prefs.weightsByPosition[position];
  if (!stored) return defaultWeightBoard(position);
  const board: Record<string, number> = {};
  for (const field of COMPS_FIELDS) {
    board[field.key] = stored[field.key] ?? 0;
  }
  return board;
}

/** Whether the reader has a stored board for this position. */
export function isCustomized(
  prefs: CompsPrefs,
  position: CompsPosition,
): boolean {
  return prefs.weightsByPosition[position] !== undefined;
}

/** Write one position's board; every other position's entry is untouched. */
export function setPositionWeights(
  prefs: CompsPrefs,
  position: CompsPosition,
  weights: Record<string, number>,
): CompsPrefs {
  return {
    ...prefs,
    weightsByPosition: {
      ...prefs.weightsByPosition,
      [position]: weights,
    },
  };
}

/**
 * Reset one position by **clearing its entry, never by writing today's
 * defaults into it** — what a board opens with is the catalogue's to change,
 * the `resolveColumns.reset` rule.
 */
export function resetPosition(
  prefs: CompsPrefs,
  position: CompsPosition,
): CompsPrefs {
  const weightsByPosition = { ...prefs.weightsByPosition };
  delete weightsByPosition[position];
  return { ...prefs, weightsByPosition };
}

export function serializeCompsPrefs(prefs: CompsPrefs): string {
  return JSON.stringify({ v: COMPS_PREFS_VERSION, ...prefs });
}

/**
 * A stored string back into prefs. Junk, an old version, or a hand-edited
 * blob all read as defaults rather than throwing — persistence here is a
 * convenience, never correctness. Field keys are validated against the
 * catalogue on read, so a selection outlives the build that wrote it: a field
 * since renamed or dropped falls away on its own rather than resetting the
 * whole board with it.
 */
export function parseCompsPrefs(raw: string | null): CompsPrefs {
  if (raw === null) return DEFAULT_COMPS_PREFS;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return DEFAULT_COMPS_PREFS;
  }
  if (typeof stored !== "object" || stored === null) {
    return DEFAULT_COMPS_PREFS;
  }
  const record = stored as Record<string, unknown>;
  if (record.v !== COMPS_PREFS_VERSION) return DEFAULT_COMPS_PREFS;

  const basis: CompsBasis =
    record.basis === "total" ? "total" : "per_game";

  const weightsByPosition: CompsPrefs["weightsByPosition"] = {};
  if (typeof record.weightsByPosition === "object" && record.weightsByPosition !== null) {
    for (const [position, board] of Object.entries(record.weightsByPosition)) {
      if (!isCompsPosition(position)) continue;
      const cleaned = cleanBoard(board);
      if (cleaned !== null) weightsByPosition[position] = cleaned;
    }
  }

  return { basis, weightsByPosition };
}

/** One stored board: known keys with integer 0–100 weights, or nothing. */
function cleanBoard(board: unknown): Record<string, number> | null {
  if (typeof board !== "object" || board === null) return null;
  const entries = board as Record<string, unknown>;
  const cleaned: Record<string, number> = {};
  // Walked in catalogue order so the cleaned object's insertion order — and
  // through it the wire spelling — is stable whatever order the blob held.
  for (const field of COMPS_FIELDS) {
    const weight = entries[field.key];
    if (
      typeof weight === "number" &&
      Number.isInteger(weight) &&
      weight >= 0 &&
      weight <= 100
    ) {
      cleaned[field.key] = weight;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}
