"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  KtcBoardChoice,
  ManagerLeaguematesPayload,
  ManagerLeaguemateRostersPayload,
  ManagerPlayersPayload,
} from "@/shared/contract";
import { apiFetch, isAbortError, useRequestGuard } from "@/features/shared";

/**
 * The three shares reads, on `useManagerLineups`' idiom: one `AbortController`
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
  /**
   * Ask again, keeping the manager, season and board exactly as they are.
   *
   * **The latch is what makes this necessary.** `enabled` goes true the first
   * time a drawer is opened and never goes back, so a request lost to a blip
   * had nothing that would ever re-run the effect: closing and reopening the
   * drawer changes no dependency, and the panel stayed on its error message
   * until the reader picked another manager, another season, another board — or
   * reloaded the page. That is the cost of the latch, and this is the one
   * control that pays it back.
   *
   * Stable across renders, so a drawer can hand it straight to a key without
   * re-rendering its list. Clears the error as it starts, because a panel
   * showing an error under a spinner is describing a request that is no longer
   * running.
   */
  retry: () => void;
};

/** What the effect actually stores. `loading` is derived from it — see below. */
type SharesState<T> = { data: T | null; error: string | null };

function useSharesResource<T>(
  path: string,
  username: string,
  season: string | null,
  enabled: boolean,
  failure: string,
  /** Extra query, already encoded, or "" — see {@link useManagerPlayers}. */
  query = "",
): SharesRead<T> {
  const [state, setState] = useState<SharesState<T>>({
    data: null,
    error: null,
  });
  const inFlight = useRef<AbortController | null>(null);
  /** Bumped by {@link SharesRead.retry} — the same subject, asked again. */
  const [attempt, setAttempt] = useState(0);

  // Reset during render, the way `useManagerLeagues` documents: an effect would
  // paint one frame of the previous manager's shares under the new manager's
  // name — and, worse here, under the new manager's selected subjects.
  const subject = `${username} ${season ?? ""} ${query}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setState({ data: null, error: null });
  }

  // The reset above is a render and the cleanup below is a passive effect, so
  // between them the previous manager's response can resolve, pass the
  // `isAbortError` guard and write itself under the new manager's name — a
  // drawer of somebody else's players, or somebody else's failure message. The
  // ticket is what closes that window, and it also keeps a retry from
  // inheriting the answer to the request it replaced. See `request-guard`.
  const guard = useRequestGuard(subject);

  const retry = useCallback(() => {
    // Cleared here rather than in the effect: `loading` is derived from
    // "neither answered nor failed", so leaving the error set would render the
    // failure and the spinner at once.
    setState({ data: null, error: null });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !season) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const ticket = guard.issue();

    const url =
      `/api/user/${encodeURIComponent(username)}/${path}` +
      `?season=${encodeURIComponent(season)}${query}`;

    void (async () => {
      try {
        const res = await apiFetch(url, {
          signal: controller.signal,
          fallbackError: failure,
        });
        const body = (await res.json()) as T;
        // The ticket rather than the abort, which has not necessarily fired.
        if (!guard.accepts(ticket)) return;
        setState({ data: body, error: null });
      } catch (err: unknown) {
        // An abort is this hook being superseded, not a failure to report: the
        // state it would write is about a manager nobody is looking at.
        if (isAbortError(err)) return;
        if (!guard.accepts(ticket)) return;
        setState({
          data: null,
          error: err instanceof Error ? err.message : failure,
        });
      }
    })();

    return () => controller.abort();
    // `attempt` is the retry; `guard` is one object for the life of the hook.
  }, [path, username, season, enabled, failure, query, attempt, guard]);

  // **Derived, not stored.** Writing `loading: true` from inside the effect is
  // a synchronous setState in an effect body — a cascading render, and what the
  // lint rule is there to stop. It is also redundant: a read that has been asked
  // for and has neither answered nor failed *is* the loading state, and deriving
  // it means the flag cannot be left true by a path that forgot to clear it.
  //
  // Memoised because the object is a prop: both drawers take it whole, and a
  // fresh one per render of the page would re-render every row they hold on
  // every stream chunk and card toggle, with nothing in it having moved.
  const loading = enabled && Boolean(season) && !state.data && !state.error;
  return useMemo(
    () => ({ data: state.data, error: state.error, loading, retry }),
    [state, loading, retry],
  );
}

/**
 * The rosters read, and the one of the two that takes a KeepTradeCut board.
 *
 * **The board joins the subject key**, which is what blanks the map for one
 * round trip rather than leaving the old market's prices under the new
 * market's name — the cost `useManagerLineups` already pays for the same flip,
 * and for the same reason: a price on the wrong board is a wrong number, not a
 * stale one. It costs nothing until a drawer has been opened, since `enabled`
 * gates the request either way.
 */
export function useManagerPlayers(
  username: string,
  season: string | null,
  enabled: boolean,
  board: KtcBoardChoice,
): SharesRead<ManagerPlayersPayload> {
  return useSharesResource(
    "players",
    username,
    season,
    enabled,
    "Failed to load rosters",
    `&ktc_board=${encodeURIComponent(board)}`,
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

/**
 * Every roster in those leagues, not just the manager's — the read behind the
 * leaguemate rail and the Owned · Taken · Available track.
 *
 * **It is latched on *either* drawer**, which is the one place the three
 * diverge, and it is a judgement rather than an oversight. The leaguemate panel
 * needs it the moment it opens, because the rail is what the panel gained; the
 * players panel needs it one press later, when a row is picked and the three
 * mode keys want their counts. Gating it on that press instead would leave the
 * counts on em dashes at exactly the moment a reader first looks at them, and
 * the fallback while it is in flight — the resting `owned` mode, off a map the
 * page already holds — is the one reading that needs nothing from here.
 *
 * It is the heaviest of the three by an order of magnitude, which is why it is
 * behind a latch at all rather than fetched with the page.
 */
export function useManagerLeaguemateRosters(
  username: string,
  season: string | null,
  enabled: boolean,
): SharesRead<ManagerLeaguemateRostersPayload> {
  return useSharesResource(
    "leaguemate-rosters",
    username,
    season,
    enabled,
    "Failed to load league rosters",
  );
}
