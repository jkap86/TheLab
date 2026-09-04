"use client";

import { useEffect, useRef, useState } from "react";

import type { RosterTimelinePayload } from "@/shared/contract";

import { apiFetch } from "./api";
import { errorMessage } from "./error-message";

/**
 * Read `GET /api/league/[leagueId]/timeline` — one league at every moment its
 * stored log can reach.
 *
 * **One request buys every stop on the rail**, which is what the payload's shape
 * is for: the browser is handed the league's log and rewinds it, so dragging the
 * timeline is arithmetic rather than a request per notch.
 *
 * **`enabled` is the whole gate, and it is a press.** This is the heaviest read
 * anything on the manager page makes — a season of a league's transactions plus
 * its whole pick grid — and the card it sits in is one of a hundred, every one
 * of them mounted. A card opened to glance at the standings must not pay for a
 * season of moves nobody scrubbed, so nothing is fetched until the reader asks
 * for the history.
 *
 * **There is no cache in front of it, and none is needed while the page
 * stands.** A `<details>` hides its body rather than unmounting it, so this hook
 * keeps its answer for as long as the card is on screen and re-opening the same
 * league re-reads nothing. What covers the case where the card does go — a
 * filter that removes the league and puts it back — is the route's own
 * `private, max-age=60`, which is the browser's cache rather than a second one
 * here.
 *
 * **It reports its failure**, where `useManagerLineups` swallows one. That hook
 * is an enhancement beside a list that stands on its own; this is the only thing
 * in the past half, and a rail that opened onto nothing with no word saying why
 * is indistinguishable from a league with no history — which is a different
 * answer and one the reader is entitled to tell apart.
 */
export type TimelineState = {
  payload: RosterTimelinePayload | null;
  loading: boolean;
  error: string | null;
};

export function useTimeline(
  leagueId: string,
  enabled: boolean,
): TimelineState {
  const [payload, setPayload] = useState<RosterTimelinePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Reset during render, the idiom `useManagerLeagues` documents: a league
  // change must not paint one frame of the previous league's rosters under this
  // league's name.
  const [renderedId, setRenderedId] = useState(leagueId);
  if (renderedId !== leagueId) {
    setRenderedId(leagueId);
    setPayload(null);
    setError(null);
  }

  useEffect(() => {
    if (!enabled) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    void (async () => {
      try {
        const res = await apiFetch(
          `/api/league/${encodeURIComponent(leagueId)}/timeline`,
          {
            signal: controller.signal,
            fallbackError: "Failed to load the league's history",
          },
        );
        setPayload((await res.json()) as RosterTimelinePayload);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(errorMessage(err, "Failed to load the league's history"));
      }
    })();

    return () => controller.abort();
  }, [leagueId, enabled]);

  return {
    payload,
    // "Asked and not answered", derived rather than stored — a flag written
    // from inside the effect is a synchronous `setState` in an effect body, and
    // it can be left true by a path that forgot to clear it.
    loading: enabled && payload === null && error === null,
    error,
  };
}
