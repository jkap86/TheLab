/**
 * Resolving a stored stat-column selection against the catalogue it picks from.
 *
 * Pure and tested, so it takes the catalogue's keys as an argument rather than
 * importing any of the four metric modules — the storage half lives in
 * `use-persisted-columns.ts`.
 */

/**
 * The columns to show: `stored` where it still names a metric this build knows,
 * `defaults` everywhere else.
 *
 * Per **slot**, not all-or-nothing, and that is the point of the function. A
 * stored selection outlives the catalogue that produced it — a metric renamed or
 * dropped, or a table given a third column — and resetting the whole row on any
 * such change would throw away three good choices to fix one stale one. A slot
 * whose metric is gone falls back on its own; an unknown key would otherwise
 * reach `MetricColumn` as a column with no cell to draw.
 *
 * `defaults` fixes the shape: a stored array that is longer (a column since
 * removed) is truncated and a shorter one filled, so the caller always gets a row
 * the current table can lay out.
 */
export function resolveColumns(
  stored: string | null,
  defaults: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  const parsed = parseStored(stored);
  return defaults.map((fallback, slot) => {
    const key = parsed?.[slot];
    return typeof key === "string" && known.has(key) ? key : fallback;
  });
}

function parseStored(stored: string | null): unknown[] | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Storage is shared with whatever wrote it last, including an older build.
    return null;
  }
}
