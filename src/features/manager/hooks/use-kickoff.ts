"use client";

import { useEffect, useState } from "react";

import { apiFetch, isAbortError } from "@/features/shared";
import type { KickoffResult } from "../types";

/**
 * When the viewed season's first regular-season game kicks off, epoch ms, off
 * `/api/kickoff` — which reads Sleeper's schedule call rather than assuming a
 * calendar.
 *
 * Three-valued on purpose: `undefined` while the answer is in flight, then the
 * payload's `number | null`. The countdown renders nothing until the fetch
 * settles — appearing once with the right instant beats appearing twice with
 * two — so "don't know yet" and "Sleeper hasn't scheduled it" must be
 * different values, since only the second is the client's cue to fall back to
 * the NFL calendar table's provisional date. The settled answer is tagged with
 * the season it belongs to and derived against the season asked for, which is
 * what makes a season switch read as unknown again without an effect writing
 * state just to blank it.
 *
 * A failure settles as null rather than surfacing: the countdown is decoration
 * on the header, so it degrades to the provisional claim, not to an error.
 */
export function useKickoff(season: string): number | null | undefined {
  const [settled, setSettled] = useState<{
    season: string;
    kickoff: number | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/kickoff?season=${encodeURIComponent(season)}`,
          {
            signal: controller.signal,
            fallbackError: "Failed to load the season schedule",
          },
        );
        const json = (await res.json()) as KickoffResult;
        if (active) setSettled({ season, kickoff: json.kickoff });
      } catch (err: unknown) {
        if (active && !isAbortError(err)) setSettled({ season, kickoff: null });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [season]);

  return settled?.season === season ? settled.kickoff : undefined;
}
