"use client";

import { useEffect, useRef, useState } from "react";

import type { KtcBoardChoice, RosterTimelinePayload } from "@/shared/contract";

import { apiFetch } from "./api";
import { errorMessage } from "./error-message";

/**
 * Which league a rail replays, and which boards its past is priced against.
 *
 * **All four fields decide the answer**, which is why they travel as one
 * subject rather than as a league id plus some options: the season and the
 * market choose *which* boards answer, and the username chooses whose synced
 * drafts the ADP is averaged over. A past roster priced on a different board
 * from the card in front of the rail is not a comparison, so this is exactly
 * what the lineups route was asked for the present.
 */
export type TimelineSubject = {
  leagueId: string;
  /** The resolved season, never the page's raw query — see `parseRequestedSeason`. */
  season: string | null;
  /** Whose ADP board the capital metrics read; null prices none of them. */
  username: string | null;
  board: KtcBoardChoice;
};

/**
 * Read `GET /api/league/[leagueId]/timeline` — one league at every moment its
 * stored log can reach, with today's boards to price each moment against.
 *
 * **One request buys every stop on the rail**, which is what the payload's shape
 * is for: the browser is handed the league's log and the boards, and solves each
 * stop itself, so dragging the timeline is arithmetic rather than a request per
 * notch.
 *
 * **`enabled` is the whole gate, and it is a press.** This is the heaviest read
 * anything on the manager page makes — a season of a league's transactions, its
 * whole pick grid and a projections board — and the card it sits in is one of a
 * hundred, every one of them mounted. A card opened to glance at the standings
 * must not pay for that, so nothing is fetched until the reader asks for the
 * history.
 *
 * **The subject is a key, and every field of it is in the key.** A season or a
 * market flip has to blank the payload for one round trip rather than leave the
 * old board's prices under the new board's name — the cost `useManagerLineups`
 * already pays for the same flip and for the same reason: a price on the wrong
 * board is a wrong number, not a stale one.
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
 * behind the rail, and a rail that opened onto nothing with no word saying why
 * is indistinguishable from a league with no history — which is a different
 * answer and one the reader is entitled to tell apart.
 */
export type TimelineState = {
  payload: RosterTimelinePayload | null;
  loading: boolean;
  error: string | null;
};

export function useTimeline(
  subject: TimelineSubject,
  enabled: boolean,
): TimelineState {
  const [payload, setPayload] = useState<RosterTimelinePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const { leagueId, season, username, board } = subject;

  // Reset during render, the idiom `useManagerLeagues` documents: a subject
  // change must not paint one frame of the previous answer under the new
  // subject's heading.
  const key = `${leagueId} ${season ?? ""} ${username ?? ""} ${board}`;
  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    setPayload(null);
    setError(null);
  }

  useEffect(() => {
    if (!enabled) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const query = new URLSearchParams({ ktc_board: board });
    if (season) query.set("season", season);
    if (username) query.set("user", username);

    void (async () => {
      try {
        const res = await apiFetch(
          `/api/league/${encodeURIComponent(leagueId)}/timeline?${query}`,
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
  }, [leagueId, season, username, board, enabled]);

  return {
    payload,
    // "Asked and not answered", derived rather than stored — a flag written
    // from inside the effect is a synchronous `setState` in an effect body, and
    // it can be left true by a path that forgot to clear it.
    loading: enabled && payload === null && error === null,
    error,
  };
}
