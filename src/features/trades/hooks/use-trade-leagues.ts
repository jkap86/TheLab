"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { ManagerLeague } from "@/shared/manager";

import { fetchTradeLeagues } from "../query-fns";
import { tradesQueryKeys } from "../query-keys";

/**
 * How long the season's league list is reused.
 *
 * It is the crawler's corpus rather than its output — it changes when a league
 * is *discovered*, not when a trade is made — so it moves at the slowest pace of
 * anything on this page.
 */
export const TRADE_LEAGUES_STALE_TIME = 15 * 60 * 1000;

export type TradeLeaguesState = {
  leagues: readonly ManagerLeague[];
  byId: ReadonlyMap<string, ManagerLeague>;
  /** True until the list has arrived — the league rules can't be applied yet. */
  loading: boolean;
  error: string | null;
};

/**
 * Every league with a trade this season.
 *
 * Three readers share it, which is the argument for it being one request rather
 * than a slice of every page: the filter dialog counts its options and breakdown
 * rows over it, the board's league rules are evaluated against it to produce the
 * ids the query is narrowed by, and every card reads its own league's name out
 * of `byId`.
 *
 * It keeps the client cache's ordinary retention rather than the board's
 * shortened one — it is a few hundred rows, and it is what a returning reader
 * needs first.
 *
 * A failure leaves the list empty rather than tearing the page down, the rule
 * `useAdpDensity` follows: the board still reads, cards fall back to their
 * league ids (the placeholder path they already had), and only the league
 * filters are unavailable. Ask what a read is load-bearing for before letting
 * its failure propagate.
 */
export function useTradeLeagues(season: string): TradeLeaguesState {
  const query = useQuery({
    queryKey: tradesQueryKeys.leagues(season),
    queryFn: ({ signal }) => fetchTradeLeagues({ season, signal }),
    staleTime: TRADE_LEAGUES_STALE_TIME,
  });

  const leagues = useMemo(() => query.data?.leagues ?? EMPTY, [query.data]);
  const byId = useMemo(
    () => new Map(leagues.map((league) => [league.league_id, league])),
    [leagues],
  );

  return {
    leagues,
    byId,
    loading: query.isPending,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/** One frozen empty array, so a failed read doesn't change identity per render. */
const EMPTY: readonly ManagerLeague[] = [];
