"use client";

import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "@/shared/util";

import { fetchJson } from "../query-fns";
import { STALE_TIMES } from "../query-config";
import { leagueQueryKeys } from "../query-keys";
import type { LeagueDetailResult } from "../types";

export type LeagueDetailState = {
  data: LeagueDetailResult | null;
  loading: boolean;
  error: string | null;
};

/**
 * A league's standings and rosters, off `/api/league/[leagueId]`. The panel that
 * calls this mounts only when its card is expanded, so a collapsed league still
 * costs no request — and a league expanded, collapsed and expanded again now
 * costs one rather than three, which is the whole reason it is a query.
 *
 * It is the one read here that **does** clear on change, and deliberately: the
 * key is the league id, with no `keepPreviousData` behind it, so a new id shows
 * nothing rather than leaving the last league's rosters on screen under the new
 * name. Everything else on these pages keeps its previous answer; this is the
 * case where the previous answer is about something else.
 */
export function useLeagueDetail(leagueId: string): LeagueDetailState {
  const detail = useQuery({
    queryKey: leagueQueryKeys.detail(leagueId),
    queryFn: ({ signal }) =>
      fetchJson<LeagueDetailResult>(
        `/api/league/${encodeURIComponent(leagueId)}`,
        "Failed to load league",
        signal,
      ),
    staleTime: STALE_TIMES.leagueDetail,
  });

  return {
    data: detail.data ?? null,
    loading: detail.isPending,
    error: detail.error ? errorMessage(detail.error, "Something went wrong") : null,
  };
}
