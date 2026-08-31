"use client";

import { useCallback, useSyncExternalStore } from "react";

// The one client-persistence mechanism, shared by everything that remembers
// something on the device — an external store over `localStorage`, read through
// `useSyncExternalStore`. It lives on its own because the rules those twenty
// lines encode are subtle enough that a second copy is a second chance to get
// one of them wrong.
//
// Three of them are load-bearing:
//
//  - **The snapshot is the raw string.** `useSyncExternalStore` compares
//    snapshots by identity, so a caller that parsed here would hand back a fresh
//    object every read, which looks like a change every render and loops.
//    Parsing belongs in a `useMemo` keyed on the string.
//  - **The server snapshot is null**, so SSR and the first client render agree —
//    reading storage during render is the hydration mismatch this shape avoids.
//    A stored value appears only after hydration.
//  - **A write notifies its own listeners by hand.** The `storage` event fires in
//    *other* tabs and never in the one that wrote.
//
// Storage can be blocked (a privacy policy, an old private mode), so every access
// is guarded and a blocked write still lands in `memoryFallback` — persistence is
// a convenience, but the store is the only state a reader has, so losing the
// write entirely would lose the thing the reader just did.

const listeners = new Set<() => void>();

const memoryFallback = new Map<string, string>();

/** The raw stored string for `key`, or null. */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memoryFallback.get(key) ?? null;
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

/** Store `value` under `key` (or clear it with null) and notify readers. */
export function writeLocal(key: string, value: string | null) {
  if (value === null) memoryFallback.delete(key);
  else memoryFallback.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage; the memory fallback above carries the session.
  }
  listeners.forEach((onStoreChange) => onStoreChange());
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  // A write in another tab should reach this one too.
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

// Server has no storage; null keeps SSR and the first client render in step.
function readServer(): null {
  return null;
}

/**
 * The raw stored string for `key` — null on the server, on the first client
 * render, and when nothing is stored. Parse it in a `useMemo` keyed on it.
 *
 * Every key shares one listener set: a write notifies all of them, and a reader
 * of some other key gets the identical string back, so React re-renders only the
 * components whose own value moved.
 */
export function useLocalValue(key: string): string | null {
  const read = useCallback(() => readLocal(key), [key]);
  return useSyncExternalStore(subscribe, read, readServer);
}
