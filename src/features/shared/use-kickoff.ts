"use client";

import { useQuery } from "@tanstack/react-query";

import type { KickoffPayload } from "@/shared/contract";

import { fetchJson } from "./api";
import { KICKOFF_STALE_TIME, scheduleQueryKeys } from "./schedule-query";

/**
 * When the viewed season's first regular-season game kicks off, epoch ms, off
 * `/api/kickoff` — which reads Sleeper's schedule call rather than assuming a
 * calendar.
 *
 * Three-valued on purpose: `undefined` while the answer is in flight, then the
 * payload's `number | null`. The countdown renders nothing until the fetch
 * settles — appearing once with the right instant beats appearing twice with
 * two — so "don't know yet" and "Sleeper hasn't scheduled it" must be different
 * values, since only the second is the client's cue to fall back to the NFL
 * calendar table's provisional date. The season is in the key, which is what
 * makes a season switch read as unknown again without an effect writing state
 * just to blank it.
 *
 * A failure settles as null rather than surfacing: the countdown is decoration
 * on the header, so it degrades to the provisional claim, not to an error — and
 * it doesn't retry, since a header that says nothing for two round trips is a
 * worse answer than the provisional one arriving now.
 *
 * The header renders on all three manager tabs and on the lineup checker, so
 * this used to be one request per navigation for an instant that is fixed once
 * the season is scheduled. It sits in `features/shared` because that header
 * does: a hook a shared component calls cannot live inside one of the tools
 * calling it.
 */
export function useKickoff(season: string): number | null | undefined {
  const kickoff = useQuery({
    queryKey: scheduleQueryKeys.kickoff(season),
    queryFn: async ({ signal }) => {
      const payload = await fetchJson<KickoffPayload>(
        `/api/kickoff?season=${encodeURIComponent(season)}`,
        "Failed to load the season schedule",
        signal,
      );
      return payload.kickoff;
    },
    staleTime: KICKOFF_STALE_TIME,
    retry: false,
  });

  if (kickoff.isError) return null;
  return kickoff.isSuccess ? kickoff.data : undefined;
}
