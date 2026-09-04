"use client";

import { useEffect, useRef, useState } from "react";

import type { KtcBoardChoice, ManagerLineupsPayload } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

/**
 * Read `GET /api/user/[username]/lineups` — one JSON answer for the whole page,
 * fetched beside the leagues stream rather than through it: the stream's job is
 * to arrive fast and show sync progress, and the lineup solve wants the synced
 * rosters that only exist once that work is done.
 *
 * `season` is the **resolved** season off the leagues stream, not the page's
 * raw query — both routes must price the same year, and sending the resolved
 * one keeps this request deterministic (see `parseRequestedSeason`).
 *
 * `ready` gates the fetch until the leagues have settled (`!refreshing` with
 * leagues on screen). It is also the refetch trigger: a cold sync flips it
 * false→true when it finishes, which is exactly when the rosters and drafts
 * this route reads came into existence.
 *
 * `board` is the reader's KeepTradeCut market choice, and it rides the request
 * rather than being applied on the client because the four KTC columns are
 * *ranked* — a rank has to exist before it can be rendered, and only the server
 * can compute one across a league's twelve rosters. **It therefore joins the
 * subject key**, so a flip blanks the ranks for the one round trip instead of
 * painting the old market's numbers under the new label. That is the same cost
 * a season change already pays, and one request for the whole page. (The trades
 * board resolves the same choice on the client, because there the number is
 * only printed — see that route for the argument.)
 *
 * A failure resolves to null and the cards simply omit the section — the
 * lineup is an enhancement beside the list, not the list, so it degrades the
 * way the refresh note does rather than replacing the page.
 */
export function useManagerLineups(
  username: string,
  season: string | null,
  ready: boolean,
  board: KtcBoardChoice,
): ManagerLineupsPayload | null {
  const [payload, setPayload] = useState<ManagerLineupsPayload | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Reset during render, the way `useManagerLeagues` does: a subject change
  // must not paint one frame of the previous manager's lineups.
  const subject = `${username} ${season ?? ""} ${board}`;
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

    const url =
      `/api/user/${encodeURIComponent(username)}/lineups` +
      `?season=${encodeURIComponent(season)}` +
      `&ktc_board=${encodeURIComponent(board)}`;

    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as ManagerLineupsPayload;
        setPayload(body);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        // Degraded, not broken — see the hook note.
      }
    })();

    return () => controller.abort();
  }, [username, season, ready, board]);

  return payload;
}
