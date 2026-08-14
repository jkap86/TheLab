"use client";

import { useCallback, useMemo } from "react";

import { useLocalValue, writeLocal } from "../shared/local-store";

import {
  COMPS_PREFS_KEY,
  parseCompsPrefs,
  serializeCompsPrefs,
} from "./prefs";

import type { CompsPrefs } from "./prefs";

/**
 * The comps prefs off the shared local store: the raw string through
 * `useLocalValue` (null on the server and the first client render, the
 * hydration rule), parsed in a `useMemo` keyed on it — parsing in the read
 * would hand back a fresh object every render and loop.
 */
export function useCompsPrefs(): {
  prefs: CompsPrefs;
  update: (next: CompsPrefs) => void;
} {
  const raw = useLocalValue(COMPS_PREFS_KEY);
  const prefs = useMemo(() => parseCompsPrefs(raw), [raw]);
  const update = useCallback((next: CompsPrefs) => {
    writeLocal(COMPS_PREFS_KEY, serializeCompsPrefs(next));
  }, []);
  return { prefs, update };
}
