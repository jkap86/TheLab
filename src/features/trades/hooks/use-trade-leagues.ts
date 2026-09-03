"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ManagerLeague } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

import { fetchTradeLeagues } from "../query-fns";

/**
 * Every league with a trade this season — asked for once, and read by three
 * different things.
 *
 * It is a hook of its own rather than a slice of the board's own fetch because
 * those three readers want it at different moments: the filter dialog counts
 * its options over the whole list, the board narrows by the ids the rules
 * leave, and every card names its league from it. One request per season
 * serves all three; folded into the pages, a few hundred leagues' worth of
 * settings blobs would ride along with every scroll.
 *
 * **A failure degrades rather than breaking the page.** The list stays empty,
 * which leaves the filter dialog with nothing to count and the cards naming
 * their leagues by id — thinner, and still a board. The trades themselves come
 * from a different request and are unaffected.
 */
export type TradeLeaguesState = {
  leagues: ManagerLeague[];
  /** The same leagues by id, for the card that has one and wants a name. */
  byId: Map<string, ManagerLeague>;
  loading: boolean;
  error: string | null;
};

const EMPTY: TradeLeaguesState = {
  leagues: [],
  byId: new Map(),
  loading: true,
  error: null,
};

export function useTradeLeagues(season: string): TradeLeaguesState {
  const [state, setState] = useState<{
    leagues: ManagerLeague[];
    loading: boolean;
    error: string | null;
  }>(EMPTY);
  const inFlight = useRef<AbortController | null>(null);

  // Reset during render, the idiom `useManagerLeagues` documents: an effect
  // would paint one frame of last season's leagues under this season's board.
  const [renderedSeason, setRenderedSeason] = useState(season);
  if (renderedSeason !== season) {
    setRenderedSeason(season);
    setState(EMPTY);
  }

  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    void (async () => {
      try {
        const payload = await fetchTradeLeagues({
          season,
          signal: controller.signal,
        });
        setState({ leagues: payload.leagues, loading: false, error: null });
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        setState({
          leagues: [],
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load leagues",
        });
      }
    })();

    return () => controller.abort();
  }, [season]);

  // Memoised on the array rather than rebuilt per render: every card in the
  // list reads this map, and a fresh one each render would be a new prop for
  // every one of them.
  const byId = useMemo(
    () => new Map(state.leagues.map((l) => [l.league_id, l])),
    [state.leagues],
  );

  return { ...state, byId };
}
