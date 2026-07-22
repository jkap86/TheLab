"use client";

import { useEffect, useState } from "react";

import type { LeaguesResult, SyncProgress } from "../types";

export type ManagerLeaguesState = {
  data: LeaguesResult | null;
  progress: SyncProgress | null;
  refreshing: boolean;
  error: string | null;
};

/**
 * Streams a manager's leagues from `/api/user/[username]/leagues`, decoding the
 * newline-delimited JSON protocol (`progress` / `result` / `error` messages)
 * into React state. Aborts the in-flight request on unmount. Callers should key
 * the owning component by `searched` so a new manager remounts with fresh state.
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
        const res = await fetch(
          `/api/user/${encodeURIComponent(searched)}/leagues`,
          { signal: controller.signal },
        );
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Failed to load leagues");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line || !active) continue;

            const msg = JSON.parse(line);
            if (msg.type === "progress") {
              setProgress(msg as SyncProgress);
            } else if (msg.type === "result") {
              setData(msg as LeaguesResult);
              setRefreshing(Boolean(msg.refreshing));
              if (!msg.refreshing) setProgress(null);
            } else if (msg.type === "error") {
              setRefreshing(false);
              setProgress(null);
              setError((prev) => prev ?? msg.error);
            }
          }
        }
      } catch (err: unknown) {
        if (active && (err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Something went wrong");
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
