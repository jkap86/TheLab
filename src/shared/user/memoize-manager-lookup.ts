import type { SleeperUser } from "@/shared/sleeper";

import type { ManagerLookup } from "./resolve-manager-id";

export const MANAGER_LOOKUP_TTL_MS = 60 * 1000;

/** Bounded, so a process asked about a decade of names doesn't hold them all. */
const MANAGER_LOOKUP_MAX = 2000;

export type MemoOptions = {
  ttlMs?: number;
  max?: number;
  now?: () => number;
};

export function memoizeManagerLookup(
  lookup: ManagerLookup,
  options: MemoOptions = {},
): ManagerLookup & { clear: () => void } {
  const {
    ttlMs = MANAGER_LOOKUP_TTL_MS,
    max = MANAGER_LOOKUP_MAX,
    now = Date.now,
  } = options;
  const entries = new Map<
    string,
    { at: number; value: Promise<SleeperUser | null> }
  >();

  const memoized = (usernameOrId: string): Promise<SleeperUser | null> => {
    // Sleeper resolves `Jkap` and `jkap` to one account, so two entries for one
    // manager is exactly the duplicate request this exists to remove — the same
    // lower-casing the client's own query keys do.
    const key = usernameOrId.toLowerCase();
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;

    const value = lookup(usernameOrId);
    entries.set(key, { at: now(), value });
    // A rejected lookup must not be served to the next caller as this one's
    // failure; dropping it here is what makes a 502 immediately retryable.
    void value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });

    if (entries.size > max) {
      // Insertion-ordered, so the first key is the oldest — one eviction per
      // insertion past the bound keeps this O(1) without a second structure.
      const oldest = entries.keys().next();
      if (!oldest.done) entries.delete(oldest.value);
    }
    return value;
  };

  memoized.clear = () => entries.clear();
  return memoized;
}