"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { GametimeStreamMessage, ManagerGametimePayload } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

/**
 * Follow one manager's week live.
 *
 * `useLineupCheck` with the read turned into a stream: the page's answer
 * arrives over `GET /api/user/[username]/gametime/stream` as Server-Sent
 * Events, pushed whenever the week's feeds move, and the plain route beside it
 * is kept for the narrowed re-read that follows a Sync press. The subject is
 * the checker's (`username`, the resolved season, the stepped week), the reset
 * happens *during render* on a subject change, and a league id is deliberately
 * not part of it — a press on one card must not blank a hundred.
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
  /** Re-read one league and merge it into what is on screen. Stable. */
  reread: (leagueId: string) => void;
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
  const rereads = useRef(new Map<string, AbortController>());
  const latest = useRef({ username, payload });
  useEffect(() => {
    latest.current = { username, payload };
  });

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

    const pendingRereads = rereads.current;
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
      for (const pending of pendingRereads.values()) pending.abort();
      pendingRereads.clear();
    };
  }, [username, season, week, ready, subject]);

  /**
   * Re-read one league against the answer already on screen — `useLineupCheck`'s
   * own re-read, over the plain route, with the same merge guard: the season and
   * week come off the payload, and an answer for another subject is dropped.
   */
  const reread = useCallback((leagueId: string) => {
    const { username: forUser, payload: current } = latest.current;
    if (!current || current.week === null) return;

    rereads.current.get(leagueId)?.abort();
    const controller = new AbortController();
    rereads.current.set(leagueId, controller);

    const query = new URLSearchParams({
      season: current.season,
      week: String(current.week),
      league: leagueId,
    });
    const url = `/api/user/${encodeURIComponent(forUser)}/gametime?${query}`;

    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as ManagerGametimePayload;
        setPayload((prev) => {
          if (!prev) return prev;
          if (body.season !== prev.season || body.week !== prev.week) return prev;
          const entry = body.leagues[leagueId];
          if (!entry) return prev;
          return { ...prev, leagues: { ...prev.leagues, [leagueId]: entry } };
        });
      } catch (err: unknown) {
        if (isAbortError(err)) return;
      } finally {
        if (rereads.current.get(leagueId) === controller) {
          rereads.current.delete(leagueId);
        }
      }
    })();
  }, []);

  return {
    payload,
    pending: payload === null && failedSubject !== subject,
    connected,
    stale,
    reread,
  };
}
