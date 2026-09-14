"use client";

import { useEffect, useRef, useState } from "react";

import type { ApiErrorPayload, VisitorLogsPayload } from "@/shared/contract";
import { errorMessage, isAbortError } from "@/features/shared";

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
  /**
   * The read answered 401: the session this page was rendered under has ended.
   * The page refreshes itself to the sign-in form on it — nothing here can
   * mint a new session, and a table that kept asking would be a 401 a second.
   */
  unauthorized: boolean;
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
 * **No credential travels on the read.** The session cookie the browser holds
 * is what authenticates it, and it is HttpOnly, so there is nothing for this
 * hook to hold or send; a plain same-origin `fetch` carries it.
 */
export function useVisitorLogs(hours: LogWindow): VisitorLogsState {
  const [payload, setPayload] = useState<VisitorLogsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [nonce, setNonce] = useState(0);
  const abort = useRef<AbortController | null>(null);

  // Reset during render, the way `useManagerLeagues` documents: an effect would
  // paint one frame of the last window's rows — and the totals counted over
  // them — under the new window's heading.
  const [renderedHours, setRenderedHours] = useState(hours);
  if (renderedHours !== hours) {
    setRenderedHours(hours);
    setPayload(null);
    setError(null);
  }

  useEffect(() => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    (async () => {
      try {
        const res = await fetch(`/api/logs?hours=${hours}`, {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        if (res.status === 401) {
          setUnauthorized(true);
          setPayload(null);
          setError("Signed out");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiErrorPayload | null;
          throw new Error(body?.error ?? `Failed to load visits (${res.status})`);
        }
        setPayload((await res.json()) as VisitorLogsPayload);
        setError(null);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        setPayload(null);
        setError(errorMessage(err, "Failed to load visits"));
      }
    })();

    return () => controller.abort();
  }, [hours, nonce]);

  return {
    payload,
    loading: payload === null && error === null,
    error,
    unauthorized,
    refresh: () => setNonce((n) => n + 1),
  };
}
