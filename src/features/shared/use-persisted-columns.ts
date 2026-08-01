"use client";

import { useCallback, useMemo } from "react";

import { resolveColumns } from "./columns.ts";
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
 */
export function usePersistedColumns(
  name: string,
  defaults: readonly string[],
  metrics: readonly { key: string }[],
): [string[], (slot: number, key: string) => void] {
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
      writeLocal(
        storageKey,
        JSON.stringify(current.map((existing, i) => (i === slot ? key : existing))),
      );
    },
    [storageKey, defaults, known],
  );

  return [columns, setColumn];
}
