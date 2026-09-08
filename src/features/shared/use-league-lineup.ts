"use client";

import { useCallback, useEffect, useState } from "react";

import type { LeagueLineupPayload } from "@/shared/contract";

import { teamsColumnQuery } from "./teams-column-query";

import { apiFetch } from "./api";
import {
  acquireLeagueLineup,
  peekLeagueLineup,
  type LeagueLineupState,
} from "./league-lineup-cache";
import type { TimelineSubject } from "./use-timeline";

/**
 * Read `GET /api/league/[leagueId]/lineup` — one league's rosters solved, for a
 * card that has been opened.
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
 * **`enabled` is a press, and it is the card's disclosure.** Both boards that
 * mount this hide a closed card's body rather than unmounting it, so a hundred
 * of these are mounted at once and a hundred closed cards must cost nothing. It
 * is also, since the manager page's batched read stopped carrying teams, that
 * page's whole per-league cost: `/manager` asks for a hundred leagues' *ranks*
 * and for the teams of the one league somebody opened.
 *
 * **The answer lives in a shared store rather than in this hook**, which is the
 * change that made the manager split affordable, and it buys four things a hook
 * holding its own state cannot: two cards naming one league make one request;
 * closing a card keeps its answer and re-opening it pays nothing; the answers
 * kept for later are bounded rather than one per card ever opened; and a sync
 * landing can ask for them again. See `league-lineup-cache`.
 *
 * **The subject is a key, and every field of it is in the key.** A season or a
 * market flip has to blank the entry for one round trip rather than leave the
 * old board's prices under the new board's name — the cost `useManagerLineups`
 * already pays for the same flip and for the same reason: a price on the wrong
 * board is a wrong number, not a stale one. It is also what makes a stale
 * response harmless: a response for the previous subject resolves into the
 * previous subject's entry, which nothing is reading.
 *
 * **It reports its failure**, where `useManagerLineups` swallows one. That hook
 * is an enhancement beside a list of leagues that stands on its own; this is the
 * whole of what an opened card has to show, and a panel that opened onto "no
 * rosters read for this league yet" with no word saying why is
 * indistinguishable from a league this database has never crawled — which is a
 * different answer, and one the reader is entitled to tell apart.
 */
export type { LeagueLineupState } from "./league-lineup-cache";

/**
 * The whole question one league is asked, as one string.
 *
 * Exported because it is also the key an invalidation matches on: a caller that
 * knows a league's rosters have been rewritten wants "every entry for this
 * league", which is a prefix of this. The league id comes first for exactly
 * that reason.
 */
export function leagueLineupKey(
  subject: TimelineSubject,
  params: string,
): string {
  const { leagueId, season, username } = subject;
  return `${leagueId} ${season ?? ""} ${username ?? ""} ${params}`;
}

export function useLeagueLineup(
  subject: TimelineSubject,
  enabled: boolean,
): LeagueLineupState {
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
  const key = leagueLineupKey(subject, params);

  // Read during render, the idiom `useManagerLeagues` documents: a subject
  // change must not paint one frame of the previous answer under the new
  // subject's heading. Where the store already holds the new key — a card
  // closed and re-opened, or a second card on the same league — this is that
  // answer immediately rather than a round trip's worth of nothing.
  const [rendered, setRendered] = useState(key);
  const [state, setState] = useState<LeagueLineupState>(() =>
    peekLeagueLineup(key),
  );
  if (rendered !== key) {
    setRendered(key);
    setState(peekLeagueLineup(key));
  }

  const load = useCallback(
    async (signal: AbortSignal, { reload }: { reload: boolean }) => {
      const query = new URLSearchParams(params);
      if (season) query.set("season", season);
      if (username) query.set("user", username);
      const res = await apiFetch(
        `/api/league/${encodeURIComponent(leagueId)}/lineup?${query}`,
        {
          signal,
          // **`reload` on an invalidation's attempt, and only then.** The route
          // answers `private, max-age=60`, which is what makes a card closed
          // and re-opened free — and would answer a post-sync re-read from the
          // pre-sync response, which is the one thing the invalidation exists
          // to prevent. `"reload"` goes to the network and replaces what the
          // browser held.
          cache: reload ? "reload" : "default",
          fallbackError: "Failed to load the league",
        },
      );
      return (await res.json()) as LeagueLineupPayload;
    },
    [leagueId, season, username, params],
  );

  useEffect(() => {
    if (!enabled) return;
    // Read on every notification rather than diffed: the store replaces its
    // state object on each transition and holds it otherwise, so this is a
    // reference comparison React makes for free.
    const sync = () => setState(peekLeagueLineup(key));
    const release = acquireLeagueLineup(key, load, sync);
    sync();
    return release;
  }, [key, load, enabled]);

  // "Asked and not answered", so the beat between `enabled` going true and the
  // effect running does not render as "this league has no rosters".
  return enabled && state.payload === null && state.error === null
    ? LOADING
    : state;
}

/** The state between `enabled` going true and the store's first publish. */
const LOADING: LeagueLineupState = {
  payload: null,
  loading: true,
  error: null,
};
