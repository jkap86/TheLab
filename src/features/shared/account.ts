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

/** Persist the resolved account (or clear it with `null`) and notify readers. */
export function storeAccount(user: UserInfo | null) {
  writeLocal(STORAGE_KEY, user ? JSON.stringify(user) : null);
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
