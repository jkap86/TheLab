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

// The same username again, as a cookie, so that `src/proxy.ts` can name whoever
// is looking when it records a visit. `localStorage` stays the app's own source
// of truth — everything in this file still reads that — and the cookie exists
// for the one reader that cannot see it: the proxy runs before any of this does.
//
// Only `/manager/[username]` carries a name in its path, so without this a
// visit to `/lineupchecker`, `/trades` or `/tools` is an address and nothing
// else. It is the one thing about a visit that cannot be derived from the route.
//
// **An underscore, not the colon the storage keys use.** A colon is a separator
// in the cookie grammar and is not legal in a cookie name; browsers vary in how
// they cope, and none of the ways is worth finding out about in production.
//
// This does not reopen the argument `theme.ts` settles against cookies. That one
// is about reading a cookie *in the root layout*, which opts the whole app out
// of static prerendering; the proxy runs per request no matter what, so `/tools`
// stays prerendered.
const VIEWER_COOKIE = "thelab_viewer";

/** A year. Long enough that it outlives the account it names, which is the point. */
const VIEWER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Persist the resolved account (or clear it with `null`) and notify readers. */
export function storeAccount(user: UserInfo | null) {
  writeLocal(STORAGE_KEY, user ? JSON.stringify(user) : null);
  writeViewerCookie(user?.username ?? null);
}

/**
 * Mirror the username into a cookie, or clear it.
 *
 * `SameSite=Lax` so it rides a top-level navigation, which is the only request
 * that matters here. No `Secure`, deliberately: development is plain HTTP, and
 * a cookie carrying a username somebody typed into a public lookup form is not
 * a secret. Wrapped because a browser can refuse cookies outright, and a
 * failure to log a visit must not stop an account being stored.
 */
function writeViewerCookie(username: string | null) {
  try {
    const value = username ? encodeURIComponent(username) : "";
    const age = username ? VIEWER_COOKIE_MAX_AGE : 0;
    document.cookie = `${VIEWER_COOKIE}=${value}; path=/; max-age=${age}; samesite=lax`;
  } catch {
    // No cookie, so visits from this browser stay anonymous. Nothing else cares.
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
