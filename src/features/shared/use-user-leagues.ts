"use client";

import { useEffect, useState } from "react";

import type { LeaguesStreamMessage } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";
import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "./api";
import { takeLines } from "./ndjson";

export type UserLeaguesState = {
  leagues: ManagerLeague[] | null;
  loading: boolean;
  error: string | null;
};

/**
 * Streams a user's leagues from `/api/user/[username]/leagues` for the pick
 * tracker's league picker — just the list, none of the progress-bar machinery
 * the manager tool's own `useManagerLeagues` carries, which is why it's a
 * separate hook rather than that one reused: the two guarantee different things.
 *
 * The endpoint is the same stale-while-revalidate stream, so a cached `result`
 * arrives first and a post-refresh one may follow; each replaces the list. The
 * first one is enough to fill the menu, so `loading` clears then rather than
 * waiting for a refresh that may still be syncing behind it.
 *
 * Keyed by `userId` (a Sleeper id resolves as readily as a name): passing null —
 * no account stored yet — fetches nothing and reports an empty, idle state,
 * which is the whole no-account path on this page (the id form still works).
 */
export function useUserLeagues(userId: string | null): UserLeaguesState {
  const [leagues, setLeagues] = useState<ManagerLeague[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    (async () => {
      // Clear the previous account up front so a slow fetch never leaves the
      // last one's leagues in the menu underneath a newly resolved id.
      setLeagues(null);
      setError(null);
      if (!userId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(
          `/api/user/${encodeURIComponent(userId)}/leagues`,
          { signal: controller.signal, fallbackError: "Failed to load leagues" },
        );
        if (!res.body) throw new Error("Failed to load leagues");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const { lines, rest } = takeLines(buffer);
          buffer = rest;
          if (!active) continue;

          for (const line of lines) {
            const message = JSON.parse(line) as LeaguesStreamMessage;
            if (message.type === "result") {
              setLeagues(message.leagues);
              setLoading(false);
            } else if (message.type === "error") {
              // Keep the first error: later ones are usually knock-on effects.
              setError((prev) => prev ?? message.error);
              setLoading(false);
            }
          }
        }
      } catch (err: unknown) {
        if (active && !isAbortError(err)) {
          setError(errorMessage(err, "Something went wrong"));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [userId]);

  return { leagues, loading, error };
}
