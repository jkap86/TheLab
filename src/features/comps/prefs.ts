// Relative pure→pure imports: this codec is tested under Node's runner.
import {
  COMPS_FIELDS,
  compsFieldTakesWindow,
  defaultWeightsFor,
  isCompsPosition,
} from "../../shared/comps/fields.ts";
import {
  DEFAULT_COMPS_WINDOW,
  isCompsWindow,
} from "../../shared/comps/windows.ts";

import type { CompsPosition } from "../../shared/comps/fields.ts";
import type { CompsBasis } from "../../shared/comps/filters.ts";
import type { CompsWindowKey } from "../../shared/comps/windows.ts";

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
  /**
   * Which seasons each field is read over, keyed by position and then by
   * field. A field absent here is read over the subject's own season, which is
   * the default — so this map holds only what the reader moved, and a board
   * with no windows serializes to nothing at all.
   */
  windowsByPosition: Partial<
    Record<CompsPosition, Record<string, CompsWindowKey>>
  >;
};

export const COMPS_PREFS_KEY = "comps-prefs";

/**
 * Bump when the stored shape changes; an old version reads as defaults.
 *
 * **Windows did not bump it**, deliberately: the addition is a second map
 * beside the first rather than a change to it, so a blob written before they
 * existed parses exactly as it did and reads as "every field over its own
 * season" — which is what it meant. Bumping would have thrown away every
 * reader's tuned board to add a field none of them had set.
 */
export const COMPS_PREFS_VERSION = 1;

export const DEFAULT_COMPS_PREFS: CompsPrefs = {
  basis: "per_game",
  weightsByPosition: {},
  windowsByPosition: {},
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

/**
 * The windows a position opens with: every catalogue field that takes one, at
 * the reader's stored choice or the default. Same shape as the weight board and
 * for the same reason — the editor draws one row per field and wants both
 * halves of a row without asking whether either was ever written.
 */
export function windowsFor(
  prefs: CompsPrefs,
  position: CompsPosition,
): Record<string, CompsWindowKey> {
  const stored = prefs.windowsByPosition[position];
  const board: Record<string, CompsWindowKey> = {};
  for (const field of COMPS_FIELDS) {
    if (!compsFieldTakesWindow(field)) continue;
    const window = stored?.[field.key];
    board[field.key] =
      window !== undefined && isCompsWindow(window)
        ? window
        : DEFAULT_COMPS_WINDOW;
  }
  return board;
}

/** Whether the reader has a stored board for this position, either half. */
export function isCustomized(
  prefs: CompsPrefs,
  position: CompsPosition,
): boolean {
  return (
    prefs.weightsByPosition[position] !== undefined ||
    prefs.windowsByPosition[position] !== undefined
  );
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
 * Write one position's windows, keeping only what differs from the default —
 * so a reader who moves a window and puts it back leaves nothing behind, and a
 * board whose windows are all default is *not* customized on that account.
 * The same rule `buildCompsQuery` keeps one layer out, kept here so the two
 * cannot disagree about what "untouched" means.
 */
export function setPositionWindows(
  prefs: CompsPrefs,
  position: CompsPosition,
  windows: Record<string, CompsWindowKey>,
): CompsPrefs {
  const moved: Record<string, CompsWindowKey> = {};
  for (const [key, window] of Object.entries(windows)) {
    if (window !== DEFAULT_COMPS_WINDOW) moved[key] = window;
  }
  const windowsByPosition = { ...prefs.windowsByPosition };
  if (Object.keys(moved).length === 0) {
    delete windowsByPosition[position];
  } else {
    windowsByPosition[position] = moved;
  }
  return { ...prefs, windowsByPosition };
}

/**
 * Reset one position by **clearing its entries, never by writing today's
 * defaults into them** — what a board opens with is the catalogue's to change,
 * the `resolveColumns.reset` rule. Both halves go: one Reset key on screen
 * means one reset, not a board that keeps its windows after its weights.
 */
export function resetPosition(
  prefs: CompsPrefs,
  position: CompsPosition,
): CompsPrefs {
  const weightsByPosition = { ...prefs.weightsByPosition };
  delete weightsByPosition[position];
  const windowsByPosition = { ...prefs.windowsByPosition };
  delete windowsByPosition[position];
  return { ...prefs, weightsByPosition, windowsByPosition };
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

  const windowsByPosition: CompsPrefs["windowsByPosition"] = {};
  if (typeof record.windowsByPosition === "object" && record.windowsByPosition !== null) {
    for (const [position, board] of Object.entries(record.windowsByPosition)) {
      if (!isCompsPosition(position)) continue;
      const cleaned = cleanWindows(board);
      if (cleaned !== null) windowsByPosition[position] = cleaned;
    }
  }

  return { basis, weightsByPosition, windowsByPosition };
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

/**
 * One stored window board: fields the catalogue still knows and still lets
 * take a window, naming windows this build still has. A default written into
 * the blob by an older client falls away here rather than being stored twice —
 * absent *is* the default, and one spelling of it is what keeps `isCustomized`
 * honest.
 */
function cleanWindows(board: unknown): Record<string, CompsWindowKey> | null {
  if (typeof board !== "object" || board === null) return null;
  const entries = board as Record<string, unknown>;
  const cleaned: Record<string, CompsWindowKey> = {};
  for (const field of COMPS_FIELDS) {
    if (!compsFieldTakesWindow(field)) continue;
    const window = entries[field.key];
    if (
      typeof window === "string" &&
      isCompsWindow(window) &&
      window !== DEFAULT_COMPS_WINDOW
    ) {
      cleaned[field.key] = window;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}
