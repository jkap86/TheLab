"use client";

import { useEffect, useRef, useState } from "react";

import type { ManagerLineupCheckPayload } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

/**
 * Read `GET /api/user/[username]/lineup-check` — one JSON answer for the whole
 * page, fetched beside the leagues stream rather than through it, exactly as
 * `useManagerLineups` is: the stream's job is to arrive fast and show sync
 * progress, and this read wants the matchups that only exist once that work is
 * done.
 *
 * `season` is the **resolved** season off the leagues stream, not the page's
 * raw query — both routes must answer for the same year.
 *
 * `week` is null until the reader steps, which is a real state rather than a
 * missing one: the route resolves the current week off Sleeper's own state,
 * which this page has no way to derive, and the answer travels back on the
 * payload. So the week *displayed* is always read off the response, and this is
 * only ever "the reader has stepped somewhere".
 *
 * `ready` gates the fetch until the leagues have settled. It is also the
 * refetch trigger: a cold sync flips it false→true when it finishes, which is
 * exactly when the matchups this route reads came into existence.
 *
 * A failure resolves to null and the tiles read as em dashes — the check is an
 * enhancement beside the list, not the list, so it degrades rather than
 * replacing the page.
 */
export function useLineupCheck(
  username: string,
  season: string | null,
  week: number | null,
  ready: boolean,
): ManagerLineupCheckPayload | null {
  const [payload, setPayload] = useState<ManagerLineupCheckPayload | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Reset during render, the way `useManagerLeagues` does: a subject change
  // must not paint one frame of the previous answer. The week is part of the
  // subject, so stepping clears the numbers rather than showing last week's
  // under this week's heading — which is the whole failure the stepper invites.
  const subject = `${username} ${season ?? ""} ${week ?? ""}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setPayload(null);
  }

  useEffect(() => {
    if (!ready || !season) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const query = new URLSearchParams({ season });
    // Omitted rather than sent blank when the reader has not stepped: the route
    // validates what it is given, and an unasked week is what it resolves.
    if (week !== null) query.set("week", String(week));
    const url =
      `/api/user/${encodeURIComponent(username)}/lineup-check?${query}`;

    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as ManagerLineupCheckPayload;
        setPayload(body);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        // Degraded, not broken — see the hook note.
      }
    })();

    return () => controller.abort();
  }, [username, season, week, ready]);

  return payload;
}
