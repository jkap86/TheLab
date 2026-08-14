"use client";

import { useQuery } from "@tanstack/react-query";

import type { RosterTimelinePayload } from "@/shared/contract";

import {
  fetchTimeline,
  timelineQueryKeys,
  TIMELINE_STALE_TIME,
} from "./timeline-query.ts";
import type { TimelineSource } from "./timeline-query.ts";

/**
 * One league at every moment its stored log can reach.
 *
 * **One request buys every stop on the rail**, which is what the payload's shape
 * is for: the browser is handed the league's log and rewinds it, so dragging the
 * timeline is arithmetic rather than a request per notch. There is nothing to gate
 * but the host being open.
 *
 * `source` is nullable, so a closed sheet — and a sheet opened from anywhere that
 * isn't a trade card — costs nothing. The read is the heaviest one either host
 * makes, so it must not fire until something has actually been opened.
 *
 * **No `keepPreviousData`**, the rule `useLeagueDetail` keeps: a different key
 * here is a different league, so the previous answer is another league's rosters.
 * Showing the wrong league's players under the right league's name is worse than
 * showing none.
 */
export type TimelineState = {
  data: RosterTimelinePayload | null;
  loading: boolean;
  error: string | null;
};

/**
 * The key a disabled query is filed under. Its id is the empty string, which no
 * caller of either route can produce — a placeholder that could collide with a
 * real entry would be a cache row answering for a league nobody asked about.
 */
const PLACEHOLDER: TimelineSource = { kind: "league", id: "" };

export function useTimeline(source: TimelineSource | null): TimelineState {
  const query = useQuery({
    queryKey: timelineQueryKeys.timeline(source ?? PLACEHOLDER),
    queryFn: ({ signal }) => fetchTimeline({ source: source!, signal }),
    enabled: source !== null,
    staleTime: TIMELINE_STALE_TIME,
  });

  return {
    data: query.data ?? null,
    // "Asked and not answered", never `isPending` — that is true of a disabled
    // query forever, which would leave a host with no source reading as loading.
    loading: query.isFetching && !query.data,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
