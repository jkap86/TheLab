"use client";

import { useMemo } from "react";

import type { UserInfo } from "@/shared/contract";

import { useLocalValue, writeLocal } from "./local-store";

// The resolved Sleeper account, remembered across reloads and trips between
// pages. The storage mechanism — the external store, the hydration-safe null
// server snapshot, the blocked-storage fallback — lives in `local-store.ts`;
// what is here is only what this key holds.
//
// It lives in `features/shared` rather than beside the tools page that writes it
// because the other tools *read* it: asking again for a username that was
// already typed on `/tools` is the re-prompting `UserLookup` exists to prevent.
const STORAGE_KEY = "thelab:sleeper-account";

// A `thelab_viewer` cookie used to be written here too, mirroring the username
// so that `src/proxy.ts` could name whoever was looking when it recorded a
// visit — the one fact a route cannot carry.
//
// **It named the wrong person, and this file is why.** `storeAccount` is called
// by the lookup form on `/tools`, which is also the only way to reach another
// manager's page: the Manager card resolves to `/manager/<stored account>`, so
// looking somebody else up means resolving them here. The cookie therefore held
// the last account this browser looked up rather than the person doing the
// looking, and a log that names the wrong person is worse than one that names
// nobody. The column went with it.
//
// What is left behind is the cookie itself, on every browser that ever resolved
// an account, with a year on it and now no reader. Expiring it below is the
// cheap half of the removal: this runs on the next lookup, which is the same
// path that wrote it.
const LEGACY_VIEWER_COOKIE = "thelab_viewer";

/** Persist the resolved account (or clear it with `null`) and notify readers. */
export function storeAccount(user: UserInfo | null) {
  writeLocal(STORAGE_KEY, user ? JSON.stringify(user) : null);
  clearLegacyViewerCookie();
}

/**
 * Expire the cookie the visit log used to read.
 *
 * Wrapped because a browser can refuse cookies outright, and tidying up after a
 * removed feature must not stop an account being stored. Deletable once no
 * browser that resolved an account before this landed is still in use — a year
 * from the last one, which is what the cookie's own max-age was.
 */
function clearLegacyViewerCookie() {
  try {
    document.cookie = `${LEGACY_VIEWER_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    // Nothing reads it; a browser holding it a while longer costs nothing.
  }
}

/**
 * The stored account, or null before one is resolved (and on the server, and on
 * the first client render). Only the resolved `UserInfo` is kept — everything
 * else about a manager re-derives from it, since the leagues reads ask by
 * `username`, so there is nothing else worth storing.
 */
export function useStoredAccount(): UserInfo | null {
  const raw = useLocalValue(STORAGE_KEY);
  // Parsed in a memo keyed on the raw string, per the store's contract: a fresh
  // object per read would look like a change every render.
  return useMemo<UserInfo | null>(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserInfo;
    } catch {
      return null;
    }
  }, [raw]);
}
