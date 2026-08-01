"use client";

import { useCallback, useMemo } from "react";

import { assignColumn, resolveColumns } from "./columns.ts";
import { readLocal, useLocalValue, writeLocal } from "./local-store";

// Namespaced so one key per table can be read at a glance in devtools, and so
// the account's own key can never be mistaken for one of these.
const KEY_PREFIX = "thelab:columns:";

/**
 * A table's stat-column selection, remembered on the device.
 *
 * Which metric each slot shows is a preference, not a view state: it is chosen
 * once and then read down a list several hundred rows long, so re-aiming four
 * columns after every reload — and after every trip out to another tool and back
 * — is the whole cost this replaces. It is stored rather than sent anywhere
 * because it is a fact about the reader's screen and the app has no server-side
 * per-user storage at all.
 *
 * Keyed by the **catalogue's grain** (`league`, `standings`, `roster`), not by
 * the page or the league — the four catalogues answer at different grains and a
 * selection only means anything against the one it was picked from, while two
 * league cards showing different columns is exactly what holding it per card
 * would bring back.
 *
 * `metrics` is the catalogue those keys are checked against, so a stored
 * selection naming a metric this build dropped falls back per slot rather than
 * reaching a column with no cell to draw.
 *
 * **`reset` is not a convenience.** Because the selection outlives the session,
 * a reader who aims all four columns somewhere unhelpful has no way back other
 * than remembering the four keys the table opened with — the stored row follows
 * them to every later visit. Handing the defaults back is what makes the
 * persistence safe to have.
 */
export function usePersistedColumns(
  name: string,
  defaults: readonly string[],
  metrics: readonly { key: string }[],
): {
  columns: string[];
  /** Point one slot at a metric, swapping with the slot that held it. */
  setColumn: (slot: number, key: string) => void;
  /** Replace the whole row — what a preset writes. */
  setColumns: (keys: readonly string[]) => void;
  /** Back to the table's opening columns. */
  reset: () => void;
} {
  const storageKey = KEY_PREFIX + name;
  const raw = useLocalValue(storageKey);

  const known = useMemo(
    () => new Set(metrics.map((metric) => metric.key)),
    [metrics],
  );
  const columns = useMemo(
    () => resolveColumns(raw, defaults, known),
    [raw, defaults, known],
  );

  // Read what is stored rather than closing over `columns`, so the callback's
  // identity doesn't move with the selection — every card in the list takes it
  // as a prop, and a hundred of them re-rendering to pick up a new function is
  // what the memoised card is there to avoid.
  const setColumn = useCallback(
    (slot: number, key: string) => {
      const current = resolveColumns(readLocal(storageKey), defaults, known);
      writeLocal(storageKey, JSON.stringify(assignColumn(current, slot, key)));
    },
    [storageKey, defaults, known],
  );

  // Written through `resolveColumns` too, so a preset naming a metric this
  // catalogue doesn't hold — the shared share presets, read by the leaguemates
  // list that has no ADP column — falls back per slot rather than being stored
  // as a key nothing can draw.
  const setColumns = useCallback(
    (keys: readonly string[]) => {
      writeLocal(
        storageKey,
        JSON.stringify(resolveColumns(JSON.stringify(keys), defaults, known)),
      );
    },
    [storageKey, defaults, known],
  );

  // Cleared rather than written back as the defaults: what a table opens with is
  // the catalogue's to change, and a reader who reset to today's four shouldn't
  // be pinned to them by a build that later picks better ones.
  const reset = useCallback(() => writeLocal(storageKey, null), [storageKey]);

  return { columns, setColumn, setColumns, reset };
}
