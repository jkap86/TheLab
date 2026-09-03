/**
 * Reading Sleeper's JSONB columns defensively.
 *
 * The `transactions` blobs arrive from `pg` as parsed JavaScript, but Sleeper
 * promises nothing about their shapes and a league with a decade of roster
 * moves has some odd ones on file — so everything below the top level is
 * `unknown` and comes through these four.
 *
 * Pure and free of runtime imports, so a reader tested under Node's own runner
 * imports it relatively with an explicit `.ts` extension the way the tests do.
 */

/** A JSONB object, or not — an array is not one, which `adds` relies on. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSONB array's elements, or none where the column holds anything else. */
export function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A number, whichever way Sleeper spelled it.
 *
 * Roster ids are documented as integers and have been seen as strings, so both
 * are read; anything else — including the `NaN` a string cast produces — is
 * null, which every caller reads as "this id says nothing" rather than as zero.
 */
export function asNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** {@link items} narrowed to the ones that are numbers. */
export function numbers(value: unknown): number[] {
  return items(value)
    .map(asNumber)
    .filter((n): n is number => n !== null);
}
