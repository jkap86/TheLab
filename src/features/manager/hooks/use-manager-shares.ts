"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ManagerLeaguematesPayload,
  ManagerPlayersPayload,
} from "@/shared/contract";
import { apiFetch, isAbortError } from "@/features/shared";

/**
 * The two shares reads, on `useManagerLineups`' idiom: one `AbortController`
 * lineage, a reset **during render** on a subject change, an `isAbortError`
 * guard on the way out.
 *
 * Two things diverge from that hook, and both are deliberate.
 *
 * **They report their failures.** Lineups resolves to null and the cards simply
 * omit a section, because a lineup is an enhancement beside a list. A drawer is
 * *only* this data, so a silent failure is a panel that opens empty with nothing
 * on screen saying why — indistinguishable from a manager who rosters nobody.
 *
 * **`enabled` is a latch rather than a gate.** It goes true when its drawer is
 * first opened and stays true, because a picked subject narrows the league grid
 * after the drawer closes and the predicate still needs the map. An unopened
 * drawer costs no request at all, which is the same bargain
 * `/api/trades/facets` strikes: a reader who never opens the panel never pays
 * for the aggregate behind it.
 */
export type SharesRead<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

/** What the effect actually stores. `loading` is derived from it — see below. */
type SharesState<T> = { data: T | null; error: string | null };

function useSharesResource<T>(
  path: string,
  username: string,
  season: string | null,
  enabled: boolean,
  failure: string,
): SharesRead<T> {
  const [state, setState] = useState<SharesState<T>>({
    data: null,
    error: null,
  });
  const inFlight = useRef<AbortController | null>(null);

  // Reset during render, the way `useManagerLeagues` documents: an effect would
  // paint one frame of the previous manager's shares under the new manager's
  // name — and, worse here, under the new manager's selected subjects.
  const subject = `${username} ${season ?? ""}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setState({ data: null, error: null });
  }

  useEffect(() => {
    if (!enabled || !season) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const url =
      `/api/user/${encodeURIComponent(username)}/${path}` +
      `?season=${encodeURIComponent(season)}`;

    void (async () => {
      try {
        const res = await apiFetch(url, {
          signal: controller.signal,
          fallbackError: failure,
        });
        const body = (await res.json()) as T;
        setState({ data: body, error: null });
      } catch (err: unknown) {
        // An abort is this hook being superseded, not a failure to report: the
        // state it would write is about a manager nobody is looking at.
        if (isAbortError(err)) return;
        setState({
          data: null,
          error: err instanceof Error ? err.message : failure,
        });
      }
    })();

    return () => controller.abort();
  }, [path, username, season, enabled, failure]);

  // **Derived, not stored.** Writing `loading: true` from inside the effect is
  // a synchronous setState in an effect body — a cascading render, and what the
  // lint rule is there to stop. It is also redundant: a read that has been asked
  // for and has neither answered nor failed *is* the loading state, and deriving
  // it means the flag cannot be left true by a path that forgot to clear it.
  return {
    ...state,
    loading: enabled && Boolean(season) && !state.data && !state.error,
  };
}

export function useManagerPlayers(
  username: string,
  season: string | null,
  enabled: boolean,
): SharesRead<ManagerPlayersPayload> {
  return useSharesResource(
    "players",
    username,
    season,
    enabled,
    "Failed to load rosters",
  );
}

export function useManagerLeaguemates(
  username: string,
  season: string | null,
  enabled: boolean,
): SharesRead<ManagerLeaguematesPayload> {
  return useSharesResource(
    "leaguemates",
    username,
    season,
    enabled,
    "Failed to load leaguemates",
  );
}
