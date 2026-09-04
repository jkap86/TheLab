"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
 *
 * {@link LineupCheckState.reread} is the other half, and the reason this returns
 * an object rather than the payload: a refresh press changes exactly one
 * league's stored lineup, and the honest response to that is to correct one row
 * of the answer rather than to fetch the account again.
 */
export type LineupCheckState = {
  /** The week's answer, or null before it lands. */
  payload: ManagerLineupCheckPayload | null;
  /**
   * Re-read one league and merge it into what is on screen.
   *
   * Stable across renders, deliberately: a card captures this in a press
   * handler, and what it must read when the press resolves is the subject that
   * is current *then* — not the one the press started under.
   */
  reread: (leagueId: string) => void;
};

export function useLineupCheck(
  username: string,
  season: string | null,
  week: number | null,
  ready: boolean,
): LineupCheckState {
  const [payload, setPayload] = useState<ManagerLineupCheckPayload | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  /**
   * One controller per league, not one for all of them: two cards re-read
   * independently, and a shared slot would have the second press cancel the
   * first — a card left showing the numbers its own sync just replaced.
   */
  const rereads = useRef(new Map<string, AbortController>());
  /**
   * What a re-read needs, read at press time rather than captured at render.
   * Written in an effect rather than during render, since a render that React
   * throws away must not move it.
   */
  const latest = useRef({ username, payload });
  useEffect(() => {
    latest.current = { username, payload };
  });

  // Reset during render, the way `useManagerLeagues` does: a subject change
  // must not paint one frame of the previous answer. The week is part of the
  // subject, so stepping clears the numbers rather than showing last week's
  // under this week's heading — which is the whole failure the stepper invites.
  //
  // **A league id and a refresh nonce are both deliberately absent from it.** A
  // press on one card is not a change of subject: putting either here would
  // blank all hundred cards, and the "needs a look" count with them, to correct
  // one row. `ready` is absent for its own reason — it is a gate *and* the
  // refetch trigger when a cold sync finishes, so promoting it would blank the
  // page every time a background refresh started.
  const subject = `${username} ${season ?? ""} ${week ?? ""}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setPayload(null);
  }

  useEffect(() => {
    if (!ready || !season) return;

    // Read once, here, so the cleanup closes over the same Map this effect saw
    // rather than reaching through the ref at teardown. The ref object never
    // changes, so this is the lint rule's shape rather than a behaviour change.
    const pendingRereads = rereads.current;

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

    return () => {
      controller.abort();
      // The re-reads were about a week nobody is looking at any more. Unlike
      // the sync POST behind them, cancelling a *read* costs the server nothing
      // it wanted to keep.
      for (const pending of pendingRereads.values()) pending.abort();
      pendingRereads.clear();
    };
  }, [username, season, week, ready]);

  /**
   * Re-read one league against the answer already on screen.
   *
   * `useCallback([])` with everything it needs on {@link latest}, so the
   * identity never changes and a card's handler cannot go stale.
   */
  const reread = useCallback((leagueId: string) => {
    const { username: forUser, payload: current } = latest.current;
    // A narrowed read *corrects one row* of an answer; it cannot be the answer.
    // Merging into nothing would put one league on screen under a heading
    // claiming the account, and the count beside it would read "1 of 1".
    if (!current || current.week === null) return;

    rereads.current.get(leagueId)?.abort();
    const controller = new AbortController();
    rereads.current.set(leagueId, controller);

    // **The week and season come off the payload, not off the props.** `week`
    // is null until the reader steps, and an unpinned re-read would let the
    // route resolve `display_week` for itself and answer a different week than
    // the one the page is showing — under the same card.
    const query = new URLSearchParams({
      season: current.season,
      week: String(current.week),
      league: leagueId,
    });
    const url =
      `/api/user/${encodeURIComponent(forUser)}/lineup-check?${query}`;

    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as ManagerLineupCheckPayload;

        setPayload((prev) => {
          if (!prev) return prev;
          // The subject moved under the request and the account-wide read that
          // replaced it owns the state now. Checked against the payload's own
          // echoed season and week rather than a token of our own, because the
          // route already promises those travel back on every answer.
          if (body.season !== prev.season || body.week !== prev.week) return prev;
          const entry = body.leagues[leagueId];
          // Absent means nothing could be solved for this league *now*. What is
          // on screen is the last thing that could be, and blanking it to say
          // so would be a claim the sync note beside it already makes better.
          if (!entry) return prev;
          // `projections` is left alone on purpose: it is a claim about the
          // account's read of the board, which one league can neither make nor
          // unmake.
          return { ...prev, leagues: { ...prev.leagues, [leagueId]: entry } };
        });
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        // Degraded, not broken — the row keeps the numbers it had, which is the
        // hook's rule one league at a time.
      } finally {
        if (rereads.current.get(leagueId) === controller) {
          rereads.current.delete(leagueId);
        }
      }
    })();
  }, []);

  return { payload, reread };
}
