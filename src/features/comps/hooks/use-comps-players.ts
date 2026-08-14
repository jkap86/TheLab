"use client";

import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "@/shared/util";

import { fetchJson } from "../../shared/api";
import { COMPS_STALE_TIMES, compsQueryKeys } from "../comps-query";

import type { CompsPlayersPayload } from "../types";

/**
 * The picker's list — every player with stored stats at a supported position.
 * One key for the whole app, since the list belongs to nobody in particular.
 */
export function useCompsPlayers(): {
  data: CompsPlayersPayload | null;
  loading: boolean;
  error: string | null;
} {
  const query = useQuery({
    queryKey: compsQueryKeys.players(),
    queryFn: ({ signal }) =>
      fetchJson<CompsPlayersPayload>(
        "/api/comps/players",
        "Failed to load players",
        signal,
      ),
    staleTime: COMPS_STALE_TIMES.players,
  });

  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: query.error
      ? errorMessage(query.error, "Something went wrong")
      : null,
  };
}
