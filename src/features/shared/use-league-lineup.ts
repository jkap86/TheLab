"use client";

import { useEffect, useRef, useState } from "react";

import type { LeagueLineupPayload } from "@/shared/contract";

import { teamsColumnQuery } from "./teams-column-query";

import { apiFetch } from "./api";
import { errorMessage } from "./error-message";
import type { TimelineSubject } from "./use-timeline";

/**
 * Read `GET /api/league/[leagueId]/lineup` — one league's rosters solved, for a
 * card that has no batched answer to draw on.
 *
 * **It is `useTimeline` for the present**, deliberately down to the subject: the
 * two reads have to be asked the same question or a card's table and the past
 * its own rail scrubs to are priced on two different rulers. So this takes the
 * identical {@link TimelineSubject} — the same season, the same manager whose
 * drafts the ADP is averaged over, the same column and therefore the same two
 * boards. What it sends beyond that is the column's *narrowing* and the key its
 * per-roster totals should be filed under, which the timeline route has no use
 * for: a stop there is solved in the browser, so a narrowing is arithmetic
 * rather than a request. See `teamsColumnQuery`.
 *
 * **`enabled` is a press, and it is the card's disclosure.** `/manager` batches
 * one lineups read for every league on its page; the trades board is
 * `accountless` and its leagues are whatever the loaded pages mention, so there
 * is nothing to batch and no account to batch it off. A hundred closed cards
 * must cost nothing, so nothing is read until a reader opens one — and, once
 * open, a `<details>` hides its body rather than unmounting it, so the answer
 * stands for as long as the card is on screen and re-opening re-reads nothing.
 * What covers a card that genuinely goes — a filter that removes the trade and
 * puts it back — is the route's own `private, max-age=60`.
 *
 * **The subject is a key, and every field of it is in the key.** A season or a
 * market flip has to blank the entry for one round trip rather than leave the
 * old board's prices under the new board's name — the cost `useManagerLineups`
 * already pays for the same flip and for the same reason: a price on the wrong
 * board is a wrong number, not a stale one.
 *
 * **It reports its failure**, where `useManagerLineups` swallows one. That hook
 * is an enhancement beside a list of leagues that stands on its own; this is the
 * whole of what an opened trade card has to show, and a panel that opened onto
 * "no rosters read for this league yet" with no word saying why is
 * indistinguishable from a league this database has never crawled — which is a
 * different answer, and one the reader is entitled to tell apart.
 */
export type LeagueLineupState = {
  payload: LeagueLineupPayload | null;
  loading: boolean;
  error: string | null;
};

export function useLeagueLineup(
  subject: TimelineSubject,
  enabled: boolean,
): LeagueLineupState {
  const [payload, setPayload] = useState<LeagueLineupPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const { leagueId, season, username, column } = subject;
  // Everything this route is asked, off the one column: the two boards it
  // prices on, the two narrowings it re-totals under, and the key the pane will
  // read the per-roster totals back by. `lineupColumnKey` folds an un-narrowed
  // column on each league's own board to its bare metric id, so a reader who
  // has forced nothing sends a key the ten totals already answer.
  // A *string*, not the record: it is both the subject key and the effect's
  // dependency, and an object literal rebuilt each render is a changed
  // dependency every render — the loop `usePublishRackControls` documents at
  // the other end of this codebase.
  const params = new URLSearchParams(teamsColumnQuery(column)).toString();

  // Reset during render, the idiom `useManagerLeagues` documents: a subject
  // change must not paint one frame of the previous answer under the new
  // subject's heading.
  // **The whole column, where the timeline's key takes the boards alone.** A
  // narrowing changes what this route ships — it is a per-roster total keyed by
  // the column — so it has to blank the entry for one round trip rather than
  // leave the old narrowing's numbers under the new one's head.
  const key = `${leagueId} ${season ?? ""} ${username ?? ""} ${params}`;
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

    const query = new URLSearchParams(params);
    if (season) query.set("season", season);
    if (username) query.set("user", username);

    void (async () => {
      try {
        const res = await apiFetch(
          `/api/league/${encodeURIComponent(leagueId)}/lineup?${query}`,
          {
            signal: controller.signal,
            fallbackError: "Failed to load the league",
          },
        );
        setPayload((await res.json()) as LeagueLineupPayload);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(errorMessage(err, "Failed to load the league"));
      }
    })();

    return () => controller.abort();
  }, [leagueId, season, username, params, enabled]);

  return {
    payload,
    // "Asked and not answered", derived rather than stored — a flag written
    // from inside the effect is a synchronous `setState` in an effect body, and
    // it can be left true by a path that forgot to clear it.
    loading: enabled && payload === null && error === null,
    error,
  };
}
