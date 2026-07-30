"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { AdpPayload } from "../types";

export type AdpState = {
  data: AdpPayload | null;
  error: string | null;
  loading: boolean;
};

/**
 * The ADP board for a query, off the global `/api/adp`.
 *
 * Unlike the four manager sub-resource hooks, this is *not* keyed to the
 * manager: ADP describes the drafts in the whole database narrowed by settings,
 * not this manager's leagues, so it calls `/api/adp` directly and re-fetches
 * whenever the query string changes rather than when the leagues stream sends a
 * new result. `query` is that string built by {@link adpQueryString}; `null`
 * means the season isn't known yet (the leagues haven't loaded), so there's
 * nothing to ask for.
 *
 * Loaded data stays put across a refetch, the same choice the resource hooks
 * make: a filter tweak shouldn't blank every ADP cell to an em dash and back
 * while the next board loads. `loading` rides alongside so the caption can say
 * it's updating without the numbers flickering.
 */
export function useAdp(query: string | null): AdpState {
  const [data, setData] = useState<AdpPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/adp?${query}`, {
          signal: controller.signal,
          fallbackError: "Failed to load ADP",
        });
        const json = (await res.json()) as AdpPayload;
        if (active) {
          setData(json);
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
  }, [query]);

  return { data, error, loading };
}
