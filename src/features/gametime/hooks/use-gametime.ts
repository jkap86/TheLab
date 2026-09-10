"use client";

import { useEffect, useState } from "react";

import type { GametimeStreamMessage, ManagerGametimePayload } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

import type { GametimeConnection } from "../helpers/connection";

/** The first backoff after a stream that will not stay open, and the ceiling. */
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 2 * 60_000;

/** The one message the server sends that is an ending rather than a fault. */
const NO_WEEK = "No week left to follow";

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
 * a press is either a no-op or a slower copy of the next frame.
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
 *
 * **A stream that will not stay open falls back to one snapshot, never to a
 * poll.** `EventSource` gives up for good on some failures — an HTTP status
 * rather than a dropped socket — and until this landed that left the page on
 * whatever it happened to be holding, which for a first visit is nothing at
 * all. So a fatal close fetches the plain route **once**, shows what it
 * answers marked `snapshot` (real numbers, not moving), and re-opens the
 * stream on a widening backoff; a stream that comes back returns the page to
 * `live` and the snapshot is never asked for again until the next fatal close.
 * What this deliberately is not is a timer that re-fetches: the solve behind
 * that body is the most expensive read this app makes, and a page of them
 * every few seconds is the cost the stream exists to avoid. Nor is a snapshot
 * fetched on an ordinary first load, where it would be a second full solve for
 * an answer the stream is already about to push.
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
  /** Where the stream is — see `GametimeConnection`. */
  connection: GametimeConnection;
  /**
   * The numbers have stopped moving behind a usable page: the room's own note
   * that Sleeper's feeds went quiet, or the reason a stream ended. A note,
   * never a replacement.
   */
  stale: string | null;
};

export function useGametime(
  username: string,
  season: string | null,
  week: number | null,
  ready: boolean,
): GametimeState {
  const armed = ready && season !== null;

  const [payload, setPayload] = useState<ManagerGametimePayload | null>(null);
  // Seeded from `armed` rather than always `"idle"`: the effect below is what
  // opens the stream and it runs after the first paint, so a page mounted with
  // its leagues already in hand would otherwise read "not following" for a
  // frame — a status pill's one job is not to say that.
  const [connection, setConnection] = useState<GametimeConnection>(
    armed ? "connecting" : "idle",
  );
  const [stale, setStale] = useState<string | null>(null);

  const subject = `${username} ${season ?? ""} ${week ?? ""}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setPayload(null);
    setStale(null);
    setConnection(armed ? "connecting" : "idle");
  }

  // A page whose league list is still arriving is not connecting and must not
  // say it is; one whose list has just landed is. Adjusted during render
  // rather than from the effect below, which is the same reason the subject
  // reset above is: a `setState` in an effect body is a second render of a
  // state React could have been given in the first.
  const [renderedArmed, setRenderedArmed] = useState(armed);
  if (renderedArmed !== armed) {
    setRenderedArmed(armed);
    // A reader who already has an answer keeps whatever the stream last said;
    // only the not-yet-connected case has a word to change.
    setConnection((held) =>
      armed ? (held === "idle" ? "connecting" : held) : "idle",
    );
  }

  useEffect(() => {
    if (!armed || !season) return;

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let stopped = false;
    /**
     * Whether a snapshot has already stood in since the last time a stream was
     * opened. Effect-local rather than a ref, so a change of subject starts
     * with a clean one — a ref would carry the previous week's failures into
     * this one and swallow its first fallback.
     */
    let snapshotTried = false;
    const snapshot = new AbortController();

    const query = new URLSearchParams({ season });
    if (week !== null) query.set("week", String(week));
    const base = `/api/user/${encodeURIComponent(username)}/gametime`;

    /**
     * One plain-route body, once per run of failures. It is deliberately not
     * retried on its own: the stream's own backoff is what tries again, and a
     * second expensive solve for a page already showing one buys nothing.
     */
    const fetchSnapshot = async () => {
      if (snapshotTried) return;
      snapshotTried = true;
      try {
        const res = await fetch(`${base}?${query}`, { signal: snapshot.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ManagerGametimePayload;
        if (stopped) return;
        setPayload(body);
        setConnection("snapshot");
      } catch (error: unknown) {
        if (isAbortError(error) || stopped) return;
        // Nothing to show and nothing in flight — the backoff below is the
        // only thing still trying.
        setConnection((held) => (held === "snapshot" ? held : "failed"));
      }
    };

    /** A stream that will not stay open: stand in for it, and try again later. */
    const giveUp = () => {
      source?.close();
      source = null;
      if (stopped) return;
      setConnection((held) => (held === "snapshot" ? held : "failed"));
      void fetchSnapshot();
      if (retry !== null) clearTimeout(retry);
      const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempts);
      attempts += 1;
      retry = setTimeout(() => {
        retry = null;
        if (!stopped) open();
      }, wait);
    };

    const open = () => {
      // One snapshot per attempt at the stream: the backoff below is what
      // bounds how often the plain route is asked for, and a snapshot that
      // itself failed deserves the next go rather than never being retried.
      snapshotTried = false;
      const es = new EventSource(`${base}/stream?${query}`);
      source = es;
      // A reader holding a snapshot keeps reading it while the next attempt is
      // made; one whose stream has already failed once is *re*-connecting, and
      // only a first attempt is plain connecting.
      setConnection((held) =>
        held === "snapshot" ? held : held === "failed" ? "reconnecting" : "connecting",
      );

      es.onopen = () => {
        attempts = 0;
        setConnection("live");
        setStale(null);
      };

      es.onmessage = (event: MessageEvent<string>) => {
        let message: GametimeStreamMessage;
        try {
          message = JSON.parse(event.data) as GametimeStreamMessage;
        } catch {
          return;
        }

        if (message.type === "payload") {
          setPayload(message.payload);
          setConnection("live");
          setStale(null);
          return;
        }
        if (message.type === "delta") {
          // Folded over what is held: the header replaces, and each of the
          // two diffed collections has its named entries replaced and its
          // removed ones dropped while the rest stand. A delta with nothing
          // held is dropped rather than presented as a page of a handful of
          // leagues — the room only ever sends one to a reader whose full
          // payload it saw accepted, so this is a guard rather than a case.
          const { leagues, removed, players, removed_players, ...header } = message.delta;
          setPayload((prev) => {
            if (!prev) return prev;
            const next = { ...prev.leagues, ...leagues };
            for (const id of removed) delete next[id];
            const board = { ...prev.players, ...players };
            for (const id of removed_players) delete board[id];
            return { ...prev, ...header, leagues: next, players: board };
          });
          setConnection("live");
          setStale(null);
          return;
        }
        if (message.type === "stale") {
          setStale(message.error);
          return;
        }
        // Terminal. Close by hand, or the browser reconnects into the same
        // refusal for as long as the tab is open.
        if (message.error === NO_WEEK) {
          es.close();
          source = null;
          setConnection("complete");
          setStale(null);
          return;
        }
        // Any other ending is a fault the server has named: keep the reason
        // beside whatever is on screen, and fall back like a fatal close.
        setStale((held) => held ?? message.error);
        giveUp();
      };

      es.onerror = () => {
        // `readyState` is the only thing that says which case this is — see
        // `usePicktracker`. A closed source will never answer on its own, so
        // the fallback is ours to run; a connecting one is the browser's own
        // reconnect, which is exactly what this transport was chosen for.
        if (es.readyState === EventSource.CLOSED) {
          giveUp();
        } else {
          setConnection((held) => (held === "snapshot" ? held : "reconnecting"));
        }
      };
    };

    open();

    return () => {
      stopped = true;
      source?.close();
      if (retry !== null) clearTimeout(retry);
      snapshot.abort();
    };
  }, [username, season, week, armed, subject]);

  return {
    payload,
    pending:
      payload === null &&
      (connection === "idle" ||
        connection === "connecting" ||
        connection === "reconnecting"),
    connection,
    stale,
  };
}
