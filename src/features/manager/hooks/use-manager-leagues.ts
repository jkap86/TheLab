"use client";

import { useEffect, useState } from "react";

import type { LeaguesStreamMessage } from "@/shared/contract";
import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { LeaguesResult, SyncProgress } from "../types";

export type ManagerLeaguesState = {
  data: LeaguesResult | null;
  progress: SyncProgress | null;
  refreshing: boolean;
  error: string | null;
};

/** Split a growing buffer into whole lines, returning the unconsumed remainder. */
function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  // The last piece has no terminating newline yet — hold it for the next chunk.
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

/**
 * Streams a manager's leagues from `/api/user/[username]/leagues`, decoding the
 * newline-delimited JSON protocol into React state. Message shapes come from
 * `@/shared/contract`'s {@link LeaguesStreamMessage}, the same contract the route
 * sends against.
 *
 * Aborts the in-flight request on unmount. Callers should key the owning
 * component by `searched` so a new manager remounts with fresh state.
 */
export function useManagerLeagues(searched: string): ManagerLeaguesState {
  const [data, setData] = useState<LeaguesResult | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/user/${encodeURIComponent(searched)}/leagues`,
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
            if (message.type === "progress") {
              setProgress(message);
            } else if (message.type === "result") {
              setData(message);
              setRefreshing(message.refreshing);
              if (!message.refreshing) setProgress(null);
            } else {
              setRefreshing(false);
              setProgress(null);
              // Keep the first error: later ones are usually knock-on effects.
              setError((prev) => prev ?? message.error);
            }
          }
        }
      } catch (err: unknown) {
        if (active && !isAbortError(err)) {
          setError(errorMessage(err, "Something went wrong"));
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [searched]);

  return { data, progress, refreshing, error };
}
