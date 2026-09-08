"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  KtcBoardChoice,
  LeagueHistoryPayload,
  RosterTimelinePayload,
} from "@/shared/contract";

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
  /**
   * Fetch the season before the oldest one on the rail, then re-read.
   *
   * A no-op where the payload names none — the far end of a complete chain — and
   * while a press is already in flight. Stable, so the key holding it does not
   * re-render the rail on every scrub.
   */
  loadEarlier: () => void;
  /** Whether that press is in flight. */
  loadingEarlier: boolean;
  /**
   * Why the last press did nothing, or null.
   *
   * A *sentence rather than a status*, because the four arms that fail are four
   * different pieces of news to a reader — a chain that has ended, a season
   * Sleeper no longer serves, somebody else already doing the work, and a fetch
   * that did not come back whole — and the key has one line to say which.
   */
  earlierError: string | null;
};

export function useTimeline(
  subject: TimelineSubject,
  enabled: boolean,
): TimelineState {
  const [payload, setPayload] = useState<RosterTimelinePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // **A re-read counter, and it is deliberately not part of the subject key.**
  // Loading an earlier season makes the rail longer without changing what it is
  // a rail *of*, so blanking the payload for the round trip would collapse the
  // control under the reader's finger and send them back to "now" — where a
  // subject change genuinely must blank it, because the old board's prices under
  // the new board's name is a wrong number rather than a stale one.
  const [reads, setReads] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const pressed = useRef(false);

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
    setEarlierError(null);
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
  }, [leagueId, season, username, board, enabled, reads]);

  // **The press is not on the house's abort lineage**, which is the one place
  // this hook diverges from every other read on the page — and it is
  // `useLeagueRefresh`'s divergence, for its reason. The POST fills *shared
  // Postgres state* rather than this component's answer, so cancelling because
  // a card was collapsed would throw away Sleeper budget already spent and leave
  // a season half-fetched for the next reader to pay for again. The guard is a
  // ref rather than `loadingEarlier`, since that is a value the render closed
  // over and a double press would slip past it inside one frame.
  const loadEarlier = useCallback(() => {
    if (pressed.current) return;
    pressed.current = true;
    setLoadingEarlier(true);
    setEarlierError(null);

    void (async () => {
      try {
        const res = await apiFetch(
          `/api/league/${encodeURIComponent(leagueId)}/timeline`,
          { method: "POST", fallbackError: EARLIER_FALLBACK },
        );
        const result = (await res.json()) as LeagueHistoryPayload;
        // A tombstoned season is re-read too, and that is the arm worth keeping:
        // nothing was added, but the chain now ends one link earlier, so the
        // re-read is what takes the key off a rail that can no longer grow.
        if (result.loaded || result.status === "gone") setReads((n) => n + 1);
        setEarlierError(earlierNote(result.status));
      } catch (err: unknown) {
        setEarlierError(errorMessage(err, EARLIER_FALLBACK));
      } finally {
        pressed.current = false;
        setLoadingEarlier(false);
      }
    })();
  }, [leagueId]);

  return {
    payload,
    // "Asked and not answered", derived rather than stored — a flag written
    // from inside the effect is a synchronous `setState` in an effect body, and
    // it can be left true by a path that forgot to clear it.
    loading: enabled && payload === null && error === null,
    error,
    loadEarlier,
    loadingEarlier,
    earlierError,
  };
}

const EARLIER_FALLBACK = "Could not load the earlier season";

/**
 * What a press that added nothing has to say for itself.
 *
 * Null for the two arms that worked — an added season and one a racing caller
 * added first — because the rail getting longer *is* the answer and a note on
 * top of it would be the key congratulating itself, which is the rule
 * `syncStatusNote` already keeps one card over. Every arm that leaves the screen
 * as the reader found it speaks, since those are otherwise indistinguishable
 * from a dead key.
 */
function earlierNote(status: LeagueHistoryPayload["status"]): string | null {
  switch (status) {
    case "added":
    case "fresh":
      return null;
    case "none":
      return "This is the league's first season";
    case "gone":
      return "Sleeper no longer has that season";
    case "locked":
      return "Already loading — try again in a moment";
    case "failed":
      return EARLIER_FALLBACK;
  }
}
