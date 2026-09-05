"use client";

import { useEffect, useRef, useState } from "react";

import type { LineupColumn, ManagerLineupsPayload } from "@/shared/contract";
import { ktcVariantsOf, serializeKtcVariants } from "@/shared/ktc/columns";
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
 * **`columns` reaches the request as the *variants* they need, not as
 * themselves.** A rank has to exist before it can be rendered and only the
 * server can compute one across a league's twelve rosters, so a column that has
 * forced a KeepTradeCut market or QB board is a board the server has to price;
 * but the nine ranks on each league's own boards always ship, so a column left
 * on `auto` — and every column with no market at all — is already answered.
 * `ktcVariantsOf` is that reduction, and it is what keeps adding a ROS tile, or
 * reordering the rack, free of a round trip.
 *
 * **The variants therefore join the subject key**, so forcing a board blanks
 * the ranks for the one round trip instead of painting the old market's numbers
 * under the new label. That is the same cost a season change already pays, and
 * one request for the whole page. (The trades board resolves its own board
 * choice on the client, because there the number is only printed — see that
 * route for the argument.)
 *
 * A failure resolves to null and the cards simply omit the section — the
 * lineup is an enhancement beside the list, not the list, so it degrades the
 * way the refresh note does rather than replacing the page.
 */
export function useManagerLineups(
  username: string,
  season: string | null,
  ready: boolean,
  columns: readonly LineupColumn[],
): ManagerLineupsPayload | null {
  const [payload, setPayload] = useState<ManagerLineupsPayload | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Reset during render, the way `useManagerLeagues` does: a subject change
  // must not paint one frame of the previous manager's lineups.
  const boards = serializeKtcVariants(ktcVariantsOf(columns));
  const subject = `${username} ${season ?? ""} ${boards}`;
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
      (boards ? `&ktc_boards=${encodeURIComponent(boards)}` : "");

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
    // `boards` and not `columns`: the array is a new identity on every render
    // of the page above, where the string moves only when a bay's market or
    // lineup does — which is the one edit that costs a request.
  }, [username, season, ready, boards]);

  return payload;
}
