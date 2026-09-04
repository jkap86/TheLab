"use client";

import { useEffect, useRef, useState } from "react";

import type { VisitorLogsPayload } from "@/shared/contract";
import { apiFetch, errorMessage, isAbortError } from "@/features/shared";

/** The windows the page offers, in hours. */
export const LOG_WINDOWS = [
  { hours: 24, label: "24h" },
  { hours: 24 * 7, label: "7d" },
  { hours: 24 * 30, label: "30d" },
] as const;

export type LogWindow = (typeof LOG_WINDOWS)[number]["hours"];

export type VisitorLogsState = {
  payload: VisitorLogsPayload | null;
  loading: boolean;
  error: string | null;
  /** Re-read the current window — the page's manual refresh. */
  refresh: () => void;
};

/**
 * Read the visit log for one window.
 *
 * Copies `use-manager-shares`' shape — one `AbortController` lineage in a ref,
 * `isAbortError` swallowed, `errorMessage` for the rest — with two divergences
 * that are this page's own:
 *
 * - **`loading` is derived, not stored.** A read that has been asked for and
 *   has neither answered nor failed *is* loading; writing it from inside the
 *   effect is the cascading `setState` the lint rule exists to stop, and it
 *   cannot be left true by a path that forgot to clear it.
 * - **It reports its failures.** This page is only this data, so a silent
 *   failure is a table that renders empty with nothing saying why — the same
 *   call the shares drawers make, and the opposite of the lineups read, which
 *   is an enhancement beside a list that stands without it.
 *
 * The token joins the subject key so that a page opened with a bad key does not
 * sit on a stale answer from a good one.
 */
export function useVisitorLogs(
  hours: LogWindow,
  token: string,
): VisitorLogsState {
  const [payload, setPayload] = useState<VisitorLogsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const abort = useRef<AbortController | null>(null);

  // Reset during render, the way `useManagerLeagues` documents: an effect would
  // paint one frame of the last window's rows — and the totals counted over
  // them — under the new window's heading. The token joins the subject so a
  // page reopened with a different key cannot sit on the old key's answer.
  const subject = `${hours} ${token}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setPayload(null);
    setError(null);
  }

  useEffect(() => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    (async () => {
      try {
        const res = await apiFetch(`/api/logs?hours=${hours}`, {
          signal: controller.signal,
          headers: { "x-logs-key": token },
          fallbackError: "Failed to load visits",
        });
        setPayload((await res.json()) as VisitorLogsPayload);
        setError(null);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        setPayload(null);
        setError(errorMessage(err, "Failed to load visits"));
      }
    })();

    return () => controller.abort();
  }, [hours, token, nonce]);

  return {
    payload,
    loading: payload === null && error === null,
    error,
    refresh: () => setNonce((n) => n + 1),
  };
}
