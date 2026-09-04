"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LeagueSyncPayload } from "@/shared/contract";
import { apiFetch, errorMessage } from "@/features/shared";

export type LeagueRefreshControl = {
  /**
   * Press it. Resolves with the server's answer, or null when the press never
   * reached one — which is what the caller gates its re-read on.
   */
  refresh: () => Promise<LeagueSyncPayload | null>;
  /** A press is in flight. */
  pending: boolean;
  /** The last answer this key got, cleared by the next press. */
  result: LeagueSyncPayload | null;
  /** The last press that never reached an answer at all. */
  error: string | null;
};

/** Nothing pressed, nothing to say. */
const IDLE = { pending: false, result: null, error: null } as const;

type Outcome = Pick<LeagueRefreshControl, "pending" | "result" | "error">;

/**
 * Drive `POST /api/league/[leagueId]/sync` for one card's sync key.
 *
 * Hand-rolled over `useState`, because this repo carries no query library and
 * the shape one would give back is the wrong one anyway: there is no key to hang
 * this on and nothing to cache — a press is an event, not a value.
 *
 * It lives in `features/lineupchecker` rather than `features/shared` on this
 * repo's own rule: only this tool presses a single league today, and "a second
 * feature reads it" is the line that moves a client piece across. It goes when
 * the manager page grows a key of its own.
 *
 * Three things about it are load-bearing:
 *
 * - **There is no `AbortController` anywhere in here**, and this is the one
 *   place the house's abort-lineage idiom is deliberately not followed. The
 *   argument is the leagues route's, at its `closed` block: the sync is filling
 *   *shared Postgres state* rather than this component's answer, so cancelling
 *   because a card was collapsed throws away Sleeper budget already spent and
 *   leaves the next reader to start over. Unmount safety is therefore a flag,
 *   not an abort, and the promise still resolves — which is what lets the
 *   parent's re-read land even when the card that pressed is gone.
 * - **The double-press guard is a ref, not `pending`.** `pending` is a value the
 *   render closed over, so two presses in one frame both read `false` and both
 *   fan out. The server would collapse them at the advisory lock, but the second
 *   would come back `cooldown` and put a wait on screen for a press that
 *   succeeded.
 * - **Every ordinary refusal is a 200 and lands in `result`, never `error`.**
 *   `cooldown`, `locked`, `gone` and `failed` are answers; `error` means the
 *   press never got one. Re-inventing them as errors here would undo the whole
 *   reason the route answers 200 to them.
 */
export function useLeagueRefresh(leagueId: string): LeagueRefreshControl {
  const [outcome, setOutcome] = useState<Outcome>(IDLE);

  const busy = useRef(false);
  /**
   * Whether this component is still mounted.
   *
   * **Assigned on mount rather than only initialised**, because StrictMode's
   * double-invoked cleanup would otherwise leave a live component permanently
   * marked dead and its key silently stuck on whatever it last said.
   */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // The house's render-time reset, with the league as the subject. The card is
  // keyed by league id upstream so this should never fire; having it makes that
  // a property of this hook rather than a convention of its callers.
  //
  // `busy` is deliberately not cleared here: it is owned by the press, whose
  // `finally` always runs, and a ref written during render is a write React may
  // throw away. A press in flight over a changed league keeps the guard until
  // it lands, which is the correct answer anyway.
  const [rendered, setRendered] = useState(leagueId);
  if (rendered !== leagueId) {
    setRendered(leagueId);
    setOutcome(IDLE);
  }

  const refresh = useCallback(async (): Promise<LeagueSyncPayload | null> => {
    if (busy.current) return null;
    busy.current = true;

    // The previous answer clears in the same transition that raises `pending`:
    // a stale "wait 9s" sitting under a live press is a lie about the press the
    // reader is watching.
    setOutcome({ pending: true, result: null, error: null });
    try {
      const res = await apiFetch(
        `/api/league/${encodeURIComponent(leagueId)}/sync`,
        { method: "POST", fallbackError: "Couldn't sync this league" },
      );
      const body = (await res.json()) as LeagueSyncPayload;
      if (live.current) setOutcome({ pending: false, result: body, error: null });
      return body;
    } catch (err: unknown) {
      if (live.current) {
        setOutcome({
          pending: false,
          result: null,
          error: errorMessage(err, "Couldn't sync this league"),
        });
      }
      return null;
    } finally {
      busy.current = false;
    }
  }, [leagueId]);

  return { ...outcome, refresh };
}
