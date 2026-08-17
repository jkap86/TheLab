import { COMPS_ENRICHMENTS, compsField } from "./fields.ts";
import { parseCompsDimensionKey } from "./windows.ts";

import type { CompsEnrichment } from "./fields.ts";

/**
 * Which expensive datasets a comparison actually needs — the gate that keeps a
 * default board off the KTC, ADP and NFL-draft reads entirely.
 *
 * The pool used to be one thing: every season's rows carried every field, so
 * building one cold season meant a season's stat lines, the player profiles, a
 * KTC snapshot, a KTC history aggregate, an ADP average and the draft
 * crosswalk — six reads, for a first board that weighs none of the last four.
 * Every market field defaults to weight 0 (`fields.ts` says why), so the
 * *typical* request paid for all of it and used none of it.
 *
 * So the datasets are named in the catalogue (`CompsField.reads`) and asked for
 * here, off the board that is actually going to run. Pure, and the only place
 * the question is answered: `pool.ts` loads what this returns and nothing else,
 * which is what makes "did enabling a KTC weight fetch ADP too" a testable
 * claim rather than a reading of the code.
 *
 * **A field merely existing in the catalogue is not a need.** What counts is a
 * positive weight on the board being run — the effective board, after the
 * parser has dropped the zero weights and after the position's defaults have
 * been resolved.
 */

/** Whether each dataset has to be loaded for the board in hand. */
export type CompsEnrichmentNeeds = Readonly<Record<CompsEnrichment, boolean>>;

const none = (): Record<CompsEnrichment, boolean> => ({
  ktc: false,
  ktc_history: false,
  adp: false,
  draft: false,
});

/** The base board's needs: nothing beyond stat lines and profiles. */
export const NO_COMPS_ENRICHMENTS: CompsEnrichmentNeeds = Object.freeze(none());

/**
 * The datasets a weighted board needs, from what its fields declare they read.
 *
 * A zero-or-negative weight names nothing — the parser already drops those, and
 * a field switched off must not drag a dataset in behind it. An unknown key
 * names nothing either: keys reaching here have been validated against the
 * catalogue, so one that isn't in it is a programming error, and refusing to
 * guess beats loading everything on the strength of a typo.
 *
 * Dimension keys are accepted as well as bare field keys, so a caller that has
 * already resolved windows gets the same answer — the window changes which
 * seasons a value pools, never which table it came out of.
 */
export function requiredCompsEnrichments(
  fields: readonly { key: string; weight: number }[],
): CompsEnrichmentNeeds {
  const needs = none();
  for (const { key, weight } of fields) {
    if (!(weight > 0)) continue;
    const field = compsField(parseCompsDimensionKey(key).field);
    if (field === undefined) continue;
    for (const enrichment of field.reads) needs[enrichment] = true;
  }
  return needs;
}

/** Whether anything beyond the base pool has to be loaded at all. */
export function anyCompsEnrichment(needs: CompsEnrichmentNeeds): boolean {
  return COMPS_ENRICHMENTS.some((enrichment) => needs[enrichment]);
}

/** The datasets needed, in catalogue order — what `pool.ts` walks. */
export function listCompsEnrichments(
  needs: CompsEnrichmentNeeds,
): CompsEnrichment[] {
  return COMPS_ENRICHMENTS.filter((enrichment) => needs[enrichment]);
}

/**
 * The needs as one cache-key segment: the datasets loaded, in catalogue order,
 * or `base` for none.
 *
 * Spelled out rather than `JSON.stringify(needs)` — the house rule that a key
 * names what the answer varies on rather than the shape of the object it was
 * read off, so adding a dataset to the catalogue can't reorder every existing
 * key. `base` is a word rather than an empty string because a key segment that
 * can be empty is one that reads as a missing segment.
 */
export function compsEnrichmentKey(needs: CompsEnrichmentNeeds): string {
  const loaded = listCompsEnrichments(needs);
  return loaded.length === 0 ? "base" : loaded.join("+");
}
