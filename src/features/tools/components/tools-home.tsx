"use client";

import { useMemo, useSyncExternalStore } from "react";

import type { UserInfo } from "@/shared/contract";

import { ToolGrid } from "./tool-grid";
import { UserLookup } from "./user-lookup";

// The resolved account, remembered across reloads and return trips to this page.
// There is no other client persistence in the app, so this small external store
// over `localStorage` is its whole story: one key, read through
// `useSyncExternalStore` so the server (which has no storage) and the first
// client render agree — the account appears only after hydration, no mismatch.
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

// The raw string, not the parsed object: `useSyncExternalStore` compares
// snapshots by identity, so a fresh `JSON.parse` on every read would look like a
// change each render and loop. Parsing happens once, in a memo keyed on this.
function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Server has no storage; null keeps SSR and the first client render in step.
function readServer(): null {
  return null;
}

function storeUser(user: UserInfo | null) {
  try {
    if (user) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked; persistence is a convenience, not correctness.
  }
  // `storage` events don't fire in the tab that wrote, so notify our own.
  listeners.forEach((onStoreChange) => onStoreChange());
}

/**
 * The tools page's interactive half: the account lookup and the tool grid, with
 * the resolved account held here so both share it. `UserLookup` writes it and
 * the pick tracker card (via `ToolGrid`) reads it to list that account's
 * leagues — the handoff the lookup section was built to make.
 *
 * The account lives in `localStorage` (above) rather than plain `useState`, so a
 * reload or a trip out to a tool and back brings it back instead of an empty
 * search box. `UserLookup`'s "Change" button clears it by writing `null`. Only
 * the resolved `UserInfo` is kept — its leagues re-derive from `user_id` (see
 * `useUserLeagues`), so there is nothing else worth storing.
 */
export function ToolsHome() {
  const raw = useSyncExternalStore(subscribe, readStored, readServer);
  const user = useMemo<UserInfo | null>(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserInfo;
    } catch {
      return null;
    }
  }, [raw]);

  return (
    <>
      <UserLookup user={user} onUserChange={storeUser} />
      <ToolGrid user={user} />
    </>
  );
}
