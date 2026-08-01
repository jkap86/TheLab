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

/**
 * Point one slot at `key`, and put whatever it held wherever `key` was.
 *
 * A plain per-slot write let the same metric land in two columns, which spends
 * one of four slots on a number already on screen — across a list several
 * hundred rows long, since the selection is list-wide. The swap is what makes
 * that unreachable *and* keeps the other three choices: a reader aiming slot 3
 * at a metric slot 1 already shows plainly wants them traded, not slot 1 blanked.
 *
 * A slot outside the row is a no-op rather than a throw: this takes a stored
 * selection's length, which `resolveColumns` fixes but a stale caller may not.
 */
export function assignColumn(
  columns: readonly string[],
  slot: number,
  key: string,
): string[] {
  if (slot < 0 || slot >= columns.length || columns[slot] === key) {
    return [...columns];
  }
  const held = columns[slot];
  const other = columns.indexOf(key);
  return columns.map((existing, i) => {
    if (i === slot) return key;
    return i === other ? held : existing;
  });
}

/**
 * A catalogue split into its captioned families, in the order it lists them.
 *
 * The metric menus are flat, which hides the fact that the catalogues are not:
 * `proj` and `proj_pts` are one number in two shapes, and the twelve league
 * metrics are really four families. Grouping is a reading of the catalogue
 * rather than a second list, so it is derived from a `group` on each metric —
 * a family appears where its first member does, and the whole thing stays one
 * ordered array to add to.
 *
 * Generic in the item and blind to everything but `group`, on the same terms as
 * {@link resolveColumns} taking the catalogue's keys: the four metric modules
 * are client display code, and this stays pure.
 */
export function groupMetrics<T extends { group?: string }>(
  metrics: readonly T[],
  fallback: string,
): { label: string; metrics: T[] }[] {
  const groups: { label: string; metrics: T[] }[] = [];
  for (const metric of metrics) {
    const label = metric.group ?? fallback;
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.metrics.push(metric);
    else groups.push({ label, metrics: [metric] });
  }
  return groups;
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
