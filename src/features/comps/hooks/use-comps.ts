"use client";

import { useEffect, useRef, useState } from "react";

import type { CompsPayload } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

import { fetchComps } from "../query-fns";
import type { CompsRequest } from "../../../shared/comps/params";

/**
 * The ranked comps for the page's current question, re-asked as it moves.
 *
 * **The recompute is a request, so it is debounced and the previous answer
 * stays on screen while the next is in flight** — the handoff's own
 * instruction, and the one place this diverges from `useTrades`, which
 * blanks its board on every key change. A weight rail fires on every step of
 * a drag, and a board that emptied on each of them would flash for the whole
 * length of the drag. So the key changing does *not* reset the payload here.
 *
 * **Except when the subject changes**, where it does, during render: the
 * previous answer is another player's comps, and holding them under the new
 * name for a round trip is a wrong claim rather than a stale one. The pool
 * count and the pairs ride the same payload, so they blank with it and come
 * back together.
 *
 * `pending` is derived — a key that has been asked and has neither answered
 * nor failed *is* pending — so it cannot be left true by a path that forgot
 * to clear it. `enabled: false` (no players loaded yet, or a subject that has
 * not been picked and no pool to count) asks nothing and reports nothing.
 */
export type CompsState = {
  payload: CompsPayload | null;
  /** A newer question is in flight than the one `payload` answers. */
  pending: boolean;
  error: string | null;
};

/** How long a rail has to be still before the question is sent. */
export const COMPS_DEBOUNCE_MS = 150;

export function useComps(
  request: CompsRequest,
  key: string,
  enabled: boolean,
): CompsState {
  const [answered, setAnswered] = useState<{
    key: string;
    payload: CompsPayload | null;
    error: string | null;
  }>({ key: "", payload: null, error: null });
  const inFlight = useRef<AbortController | null>(null);

  // Reset during render on a subject change, the idiom `useManagerLeagues`
  // documents — an effect would paint one frame of the old player's comps
  // under the new player's plate.
  const [renderedSubject, setRenderedSubject] = useState(request.subject);
  if (renderedSubject !== request.subject) {
    setRenderedSubject(request.subject);
    setAnswered({ key: "", payload: null, error: null });
  }

  useEffect(() => {
    if (!enabled) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const payload = await fetchComps({ request, signal: controller.signal });
          if (controller.signal.aborted) return;
          setAnswered({ key, payload, error: null });
        } catch (err: unknown) {
          if (isAbortError(err)) return;
          setAnswered((prev) => ({
            key,
            // A failure keeps the last good board under an error line rather
            // than blanking it: the rails are still where the reader left
            // them, and the board still answers the question before this one.
            payload: prev.payload,
            error: err instanceof Error ? err.message : "Failed to run the comp",
          }));
        }
      })();
    }, COMPS_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `request` is what `key` serialises, so the key is the dependency; the
    // object is rebuilt per render and would re-ask on every one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return {
    payload: answered.payload,
    pending: enabled && answered.key !== key && answered.error === null,
    error: answered.error,
  };
}
