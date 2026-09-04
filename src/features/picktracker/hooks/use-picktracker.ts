"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, isAbortError, errorMessage } from "@/features/shared";
import type {
  PicktrackerPayload,
  PicktrackerStreamMessage,
} from "@/shared/contract";

export type PicktrackerState = {
  /** The board, or null before the first one arrives. Never null afterwards. */
  data: PicktrackerPayload | null;
  /** The stream is open and the server is answering. */
  connected: boolean;
  /**
   * The board has stopped moving behind a usable list — ticks are failing, or
   * the connection dropped. A note, never a replacement for the board.
   */
  stale: string | null;
  /** Nothing could be shown at all, and retrying will not help. */
  error: string | null;
  /** Re-read the snapshot route by hand. */
  refresh: () => void;
  /** A manual refresh is in flight. */
  refreshing: boolean;
};

/**
 * Follow one league's placeholder draft.
 *
 * Reads the SSE stream in `/api/picktracker/[leagueId]/stream`, where a single
 * shared poller per league does the Sleeper work — see `shared/picktracker/live`
 * for why that lives on the server rather than as a timer in here.
 *
 * **`EventSource` rather than `fetch` + a reader**, which is the one place this
 * hook departs from the house idiom. It needs no headers, and its automatic
 * reconnect is exactly what a tool watched for three hours wants: a laptop
 * sleeping or a phone changing network resumes without anything in here. The
 * cost is that reconnection has to be *stopped* by hand, which is what the
 * terminal `error` message is for — without that, a league id that will never
 * resolve is retried a second apart, forever, by every tab that opened it.
 *
 * **The board is never cleared except by a change of league.** A reconnect that
 * blanked it would flash an empty page every time a phone changed cell, and a
 * manual refresh that blanked it would do the same on every press. The only
 * reset is the render-time one below, which is the idiom `useManagerLeagues`
 * documents: notice the subject changed while rendering and start over, so
 * nothing is ever shown against the wrong league.
 */
export function usePicktracker(leagueId: string): PicktrackerState {
  const [data, setData] = useState<PicktrackerPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const inFlight = useRef<AbortController | null>(null);
  // `refresh` is handed to a button and must keep one identity, so what it
  // needs that changes lives on a ref rather than in its deps.
  const latest = useRef(leagueId);

  const [renderedSubject, setRenderedSubject] = useState(leagueId);
  if (renderedSubject !== leagueId) {
    setRenderedSubject(leagueId);
    setData(null);
    setConnected(false);
    setStale(null);
    setError(null);
    setRefreshing(false);
  }

  useEffect(() => {
    latest.current = leagueId;
  }, [leagueId]);

  useEffect(() => {
    const source = new EventSource(
      `/api/picktracker/${encodeURIComponent(leagueId)}/stream`,
    );

    source.onopen = () => {
      setConnected(true);
      setStale(null);
    };

    source.onmessage = (event: MessageEvent<string>) => {
      let message: PicktrackerStreamMessage;
      try {
        message = JSON.parse(event.data) as PicktrackerStreamMessage;
      } catch {
        return; // a frame we cannot read is not a reason to drop the board
      }

      if (message.type === "board") {
        setData(message.payload);
        setStale(null);
        setError(null);
        return;
      }
      if (message.type === "stale") {
        setStale(message.error);
        return;
      }
      // Terminal. Close by hand, or the browser reconnects into the same
      // refusal for as long as the tab is open.
      setError(message.error);
      setConnected(false);
      source.close();
    };

    source.onerror = () => {
      setConnected(false);
      // **`onerror` says nothing about why, and `readyState` is the only thing
      // that distinguishes the two cases.** `CONNECTING` means the browser has
      // already scheduled a retry — a dropped connection, which is a note
      // beside a board that is still the last thing the server said. `CLOSED`
      // means it has given up (a bad status, a wrong content type) and nothing
      // further will arrive, so the reader has to be told the updates have
      // stopped rather than left watching a board labelled "reconnecting"
      // forever. Treating both as a failure would blank a board every time a
      // phone changed cell.
      setStale(
        source.readyState === EventSource.CLOSED
          ? "Live updates unavailable — press Refresh to re-read"
          : "Reconnecting…",
      );
    };

    return () => source.close();
  }, [leagueId]);

  const refresh = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const leagueId = latest.current;

    setRefreshing(true);
    void (async () => {
      try {
        const res = await apiFetch(
          `/api/picktracker/${encodeURIComponent(leagueId)}`,
          { signal: controller.signal, fallbackError: "Failed to read the draft" },
        );
        const payload = (await res.json()) as PicktrackerPayload;
        // A late answer for a league nobody is looking at any more.
        if (latest.current !== leagueId) return;
        setData(payload);
        setStale(null);
        setError(null);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        // A failed press leaves the board alone and says so beside it — the
        // same rule the stream's `stale` follows.
        setStale(errorMessage(err, "Failed to read the draft"));
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
  }, []);

  useEffect(() => () => inFlight.current?.abort(), []);

  return { data, connected, stale, error, refresh, refreshing };
}
