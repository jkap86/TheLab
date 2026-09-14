"use client";

import { useEffect, useState } from "react";

import type { ManagerGametimePayload } from "@/shared/contract";

import type { GametimeConnection } from "../helpers/connection";
import { followGametime } from "./live-connection";
import type { LiveEnv } from "./live-connection";

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
 * **The stream, the snapshot that stands in for it and the backoff between
 * attempts are `followGametime`'s** (`./live-connection`), which takes the
 * `EventSource`, the `fetch` and the timers as arguments so its races can be
 * driven under Node's own runner — which one owns a snapshot that lands after
 * the stream has recovered, whether a stream that opens and then fails resets
 * the backoff, whether a superseded source can close the one that replaced
 * it. None of those fail visibly, and the browser is the one place they
 * cannot be scripted. What is left here is what only a hook can do: hold the
 * three pieces of state, reset them on a subject change, and hand the
 * controller the browser's own environment.
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

/** The browser's own transport, clock and fetch. */
const browserEnv: LiveEnv = {
  openSource: (url) => new EventSource(url),
  fetch: (url, init) => fetch(url, init),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
  now: () => Date.now(),
  random: () => Math.random(),
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
    // The cleanup is the controller's own stop: it closes the source, clears
    // the one retry that may be scheduled and retires any snapshot in flight,
    // so a change of subject — or an unmount — leaves nothing that could
    // write under the next subject's heading.
    return followGametime(
      { username, season, week },
      { setPayload, setConnection, setStale },
      browserEnv,
    );
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
