"use client";

import { useEffect, useState } from "react";

import type { GametimeStreamMessage, ManagerGametimePayload } from "@/shared/contract";

/**
 * Follow one manager's week live.
 *
 * `useLineupCheck` with the read turned into a stream: the page's answer
 * arrives over `GET /api/user/[username]/gametime/stream` as Server-Sent
 * Events, pushed whenever the week's feeds move. The subject is the checker's
 * (`username`, the resolved season, the stepped week) and the reset happens
 * *during render* on a subject change.
 *
 * **Nothing here re-reads one league by hand, where `useLineupCheck` does.**
 * That hook's `reread` exists for the checker's Sync key, which is a control
 * for a page that reads once; the numbers here already move on their own, so
 * a press is either a no-op or a slower copy of the next frame. The plain
 * route's `?league=` narrowing is still the checker's and still answers — it
 * simply has no caller on this page.
 *
 * **`EventSource` rather than `fetch` + a reader**, on `usePicktracker`'s
 * argument: its automatic reconnect is exactly what a page watched for three
 * hours wants, and the cost — that reconnection has to be *stopped* by hand —
 * is what the terminal `error` message is for.
 *
 * **The payload is never cleared by a reconnect.** A phone changing cell must
 * not flash an empty page; a dropped stream is a note beside the last answer
 * the server gave, which is still the best one there is. Only a change of
 * subject blanks it, during render, so nothing is ever shown under the wrong
 * heading.
 */
export type GametimeState = {
  /** The week's answer, or null before the first one lands. */
  payload: ManagerGametimePayload | null;
  /**
   * The first answer is still on its way — not `payload === null`, which is
   * also true after a stream that will never answer. See
   * `LineupCheckState.pending` for why the two are told apart.
   */
  pending: boolean;
  /** The stream is open and the server is answering. */
  connected: boolean;
  /**
   * The numbers have stopped moving behind a usable page — the connection
   * dropped, or the feeds behind it did. A note, never a replacement.
   */
  stale: string | null;
};

export function useGametime(
  username: string,
  season: string | null,
  week: number | null,
  ready: boolean,
): GametimeState {
  const [payload, setPayload] = useState<ManagerGametimePayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [failedSubject, setFailedSubject] = useState<string | null>(null);

  const subject = `${username} ${season ?? ""} ${week ?? ""}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setPayload(null);
    setFailedSubject(null);
    setStale(null);
    setConnected(false);
  }

  useEffect(() => {
    if (!ready || !season) return;

    const query = new URLSearchParams({ season });
    if (week !== null) query.set("week", String(week));
    const source = new EventSource(
      `/api/user/${encodeURIComponent(username)}/gametime/stream?${query}`,
    );

    source.onopen = () => {
      setConnected(true);
      setStale(null);
    };

    source.onmessage = (event: MessageEvent<string>) => {
      let message: GametimeStreamMessage;
      try {
        message = JSON.parse(event.data) as GametimeStreamMessage;
      } catch {
        return;
      }

      if (message.type === "payload") {
        setPayload(message.payload);
        setStale(null);
        return;
      }
      if (message.type === "delta") {
        // Folded over what is held: the header replaces, the moved leagues
        // replace their own entries, and the rest stand. A delta with nothing
        // held is a frame the server sent before this reader's first payload
        // arrived, which cannot happen on one stream — dropped rather than
        // presented as a page of a handful of leagues.
        const { leagues, removed, ...header } = message.delta;
        setPayload((prev) => {
          if (!prev) return prev;
          const next = { ...prev.leagues, ...leagues };
          for (const id of removed) delete next[id];
          return { ...prev, ...header, leagues: next };
        });
        setStale(null);
        return;
      }
      if (message.type === "stale") {
        setStale(message.error);
        return;
      }
      // Terminal. Close by hand, or the browser reconnects into the same
      // refusal for as long as the tab is open. A page with an answer keeps it
      // and reads as done; one without is told the read failed.
      setFailedSubject(subject);
      setConnected(false);
      setStale((held) => held ?? (message.error === "No week left to follow" ? null : message.error));
      source.close();
    };

    source.onerror = () => {
      setConnected(false);
      // `readyState` is the only thing that says which case this is — see
      // `usePicktracker`. A closed source will never answer, so a page with
      // nothing yet is told so rather than left on a flask.
      if (source.readyState === EventSource.CLOSED) {
        setFailedSubject(subject);
        setStale("Live updates unavailable");
      } else {
        setStale("Reconnecting…");
      }
    };

    return () => {
      source.close();
    };
  }, [username, season, week, ready, subject]);

  return {
    payload,
    pending: payload === null && failedSubject !== subject,
    connected,
    stale,
  };
}
