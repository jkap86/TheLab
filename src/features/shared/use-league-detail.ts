"use client";

import { useQuery } from "@tanstack/react-query";

import type { LeagueDetailPayload } from "@/shared/contract";
import { errorMessage } from "@/shared/util";

import { fetchJson } from "./api";
import { LEAGUE_DETAIL_STALE_TIME, leagueQueryKeys } from "./league-query";

export type LeagueDetailState = {
  data: LeagueDetailPayload | null;
  loading: boolean;
  error: string | null;
};

/**
 * A league's standings and rosters, off `/api/league/[leagueId]`. The panel that
 * calls this mounts only when something is opened onto it — a league card
 * expanded, or a trade card pressed — so a collapsed league still costs no
 * request, and one opened, closed and opened again now costs one rather than
 * three, which is the whole reason it is a query.
 *
 * `board` is the ADP drawer's own query string, the same one the collapsed card's
 * team value is priced on: the panel's two value columns read it, so a drawer
 * narrowed to startup drafts narrows the number in the row as well as the number
 * on the card. The rosters themselves don't depend on it, but they arrive on one
 * payload, so it is part of the key.
 *
 * `week` narrows the same payload to one week, which the lineup checker asks for
 * and the leagues list and trades board do not: it adds each subject's
 * projection for that week and its points per game coming into it, the two
 * columns a panel opened on a *lineup* is read on. Null means "as a season",
 * which is the answer those two want and the shape this route has always given.
 *
 * **It clears on a new league and holds through a new board or a new week**,
 * which is one rule rather than three exceptions. This is the read whose previous
 * answer can be about something else: a new id must show nothing rather than
 * leave the last league's rosters on screen under the new name. A new board or
 * week of the same league is the opposite case — the rows are right, two columns
 * are about to move — and blanking several hundred of them to redraw them nearly
 * unchanged is the flash every other hook here refuses. So the placeholder is
 * kept only when the previous key names this same league, which is exactly what
 * comparing against the *league* prefix buys.
 */
export function useLeagueDetail(
  leagueId: string,
  board: string,
  week: number | null = null,
): LeagueDetailState {
  const detail = useQuery({
    queryKey: leagueQueryKeys.detail(leagueId, board, week),
    queryFn: ({ signal }) =>
      fetchJson<LeagueDetailPayload>(
        `/api/league/${encodeURIComponent(leagueId)}?${board}` +
          (week === null ? "" : `&week=${week}`),
        "Failed to load league",
        signal,
      ),
    staleTime: LEAGUE_DETAIL_STALE_TIME,
    // Compared against the *league* prefix rather than the whole key, since the
    // whole key is what just changed. `keepPreviousData` would have kept the
    // previous league's rosters too, which is the one thing this must not do.
    placeholderData: (previous, previousQuery) => {
      const prefix = leagueQueryKeys.league(leagueId);
      const key = previousQuery?.queryKey;
      const sameLeague =
        Array.isArray(key) && prefix.every((segment, i) => key[i] === segment);
      return sameLeague ? previous : undefined;
    },
  });

  return {
    data: detail.data ?? null,
    loading: detail.isPending,
    error: detail.error ? errorMessage(detail.error, "Something went wrong") : null,
  };
}
