"use client";

import { useMemo, useSyncExternalStore } from "react";

import type { UserInfo } from "@/shared/contract";

// The resolved Sleeper account, remembered across reloads and trips between
// pages. There is no other client persistence in the app, so this small external
// store over `localStorage` is its whole story: one key, read through
// `useSyncExternalStore` so the server (which has no storage) and the first
// client render agree — the account appears only after hydration, no mismatch.
//
// It lives in `features/shared` rather than beside the tools page that writes it
// because the pick tracker *reads* it: its league picker is on its own page now,
// and asking for a username there that was already typed on `/tools` is the
// re-prompting `UserLookup` exists to prevent.
const STORAGE_KEY = "thelab:sleeper-account";

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  // A write in another tab should reach this one too.
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

// When `localStorage` is blocked (a privacy policy, an old private mode), the
// account still has to live *somewhere* for this session — the store is the
// only state, so with no fallback a successful lookup would be silently
// discarded and the tools grid would stay locked with nothing to show for it.
// Persistence is the convenience; this variable is the correctness.
let memoryFallback: string | null = null;

// The raw string, not the parsed object: `useSyncExternalStore` compares
// snapshots by identity, so a fresh `JSON.parse` on every read would look like a
// change each render and loop. Parsing happens once, in a memo keyed on this.
function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

// Server has no storage; null keeps SSR and the first client render in step.
function readServer(): null {
  return null;
}

/** Persist the resolved account (or clear it with `null`) and notify readers. */
export function storeAccount(user: UserInfo | null) {
  const serialized = user ? JSON.stringify(user) : null;
  memoryFallback = serialized;
  try {
    if (serialized) window.localStorage.setItem(STORAGE_KEY, serialized);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked; the memory fallback above carries the session.
  }
  // `storage` events don't fire in the tab that wrote, so notify our own.
  listeners.forEach((onStoreChange) => onStoreChange());
}

/**
 * The stored account, or null before one is resolved (and on the server, and on
 * the first client render). Only the resolved `UserInfo` is kept — a manager's
 * leagues re-derive from `user_id` (see `useUserLeagues`), so there is nothing
 * else worth storing.
 */
export function useStoredAccount(): UserInfo | null {
  const raw = useSyncExternalStore(subscribe, readStored, readServer);
  return useMemo<UserInfo | null>(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserInfo;
    } catch {
      return null;
    }
  }, [raw]);
}
