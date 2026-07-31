"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { AdpDensityResult, DraftDensityMonth } from "../types";

export type AdpDensityState = {
  /** Ascending by month; empty until the first load lands, and after a failure. */
  months: DraftDensityMonth[];
  error: string | null;
  loading: boolean;
};

/**
 * Crawled drafts per month, off `/api/adp/density` — the strip the range
 * scrubber draws under the ADP board's window.
 *
 * Unlike {@link useAdp}, which re-fetches on the board's query string, this
 * takes no query and re-fetches on nothing: the histogram describes the whole
 * crawled population *before* any board filter, deliberately, so that it holds
 * still while a window is dragged across it. `enabled` is the drawer being open,
 * which is the same gate the board itself is behind — a tab nobody opened the
 * drawer on costs no request.
 *
 * A failure leaves `months` empty rather than throwing the control away. The
 * scrubber still works without bars: the presets, the NFL calendar markers and
 * the handles need no density at all, so the strip degrades to an axis and the
 * caption says the activity is unavailable.
 */
export function useAdpDensity(enabled: boolean): AdpDensityState {
  const [months, setMonths] = useState<DraftDensityMonth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch("/api/adp/density", {
          signal: controller.signal,
          fallbackError: "Failed to load draft activity",
        });
        const json = (await res.json()) as AdpDensityResult;
        if (active) {
          setMonths(json.months);
          setError(null);
        }
      } catch (err: unknown) {
        if (active && !isAbortError(err)) {
          setError(errorMessage(err, "Something went wrong"));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled]);

  return { months, error, loading };
}
