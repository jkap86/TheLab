"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import type { LeagueSyncPayload } from "@/shared/contract";
import { errorMessage } from "@/shared/util";

import { apiFetch } from "./api";
import { leagueQueryKeys } from "./league-query";
import { lineupQueryKeys } from "./lineup-query";

/** What the panel's sync key needs to draw itself and to fire. */
export type LeagueRefreshControl = {
  /** Ask the server to re-read this league. A no-op while one is in flight. */
  refresh: () => void;
  /** True from the press until the answer lands. */
  pending: boolean;
  /** The last answer, or null before the first press. */
  result: LeagueSyncPayload | null;
  /** The last failure, or null. Cleared by the next press. */
  error: string | null;
};

/**
 * Re-read one league from Sleeper and mark what that makes stale.
 *
 * **The point of the press is what is on screen, not what the route did**, so
 * every path that could have moved the stored graph invalidates before this
 * resolves — the panel refetches, the row above it refetches, and the reader
 * sees the lineup they just set. Without that the answer would be a status
 * message over data the reader can see is unchanged.
 *
 * A `useMutation` rather than a hand-rolled `useState` pair, because it is the
 * one read on these pages that a reader *fires* rather than one a key derives:
 * it needs a pending flag, a last answer and a last error with no query key to
 * hang them on, and it must survive its own component unmounting — a card closed
 * mid-refresh must not leave a `setState` looking for a component that has gone.
 *
 * **The request carries no `AbortSignal`, deliberately.** A refresh fills
 * *shared* Postgres state rather than this component's answer, the same reason
 * the leagues route lets a background sync outlive the browser that started it:
 * cancelling on a closed card would throw away Sleeper budget already spent and
 * leave the next reader to spend it again. The server's own bounds are what make
 * that safe to say — see `refreshLeague`.
 */
export function useLeagueRefresh(leagueId: string): LeagueRefreshControl {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (): Promise<LeagueSyncPayload> => {
      const res = await apiFetch(
        `/api/league/${encodeURIComponent(leagueId)}/sync`,
        { method: "POST", fallbackError: "Failed to refresh league" },
      );
      return (await res.json()) as LeagueSyncPayload;
    },
    onSuccess: (result) => invalidateAfterRefresh(queryClient, leagueId, result),
  });

  return {
    // Guarded here rather than by disabling the key alone: a key can be pressed
    // by a keyboard repeat or a double tap in the frame before `pending` lands,
    // and a second POST would queue on the server's own per-league lock for a
    // fan-out the first one is already running.
    refresh: () => {
      if (!mutation.isPending) mutation.mutate();
    },
    pending: mutation.isPending,
    result: mutation.data ?? null,
    error: mutation.error ? errorMessage(mutation.error, "Something went wrong") : null,
  };
}

/**
 * Mark what a refresh of one league left behind.
 *
 * **Two entries, because two reads describe this league and they are not both
 * the panel's.** The panel's own detail is the obvious one; the other is the
 * lineup checker's matchups, which is where the *card* this panel opened out of
 * gets the shortfall on its stat columns. Leaving that alone is how a reader
 * ends up with a panel reporting nothing left on the bench over a row still
 * quoting the twelve points they have just moved — one league, two answers, and
 * the second one wrong for as long as its own stale time lasts.
 *
 * It is addressed by its **prefix** rather than by a key built from an account
 * and a week: which reader is looking and which week they are on are facts this
 * module has no business knowing, and a league that moved is worth re-asking
 * whichever week is on screen. That prefix is the whole of the lineup checker's
 * cache, which is why the table sits in `features/shared` — see `./lineup-query`.
 *
 * **Nothing else, and never a bare `invalidateQueries()`**, which would take the
 * ADP board, every other league's detail and every manager's entries with it.
 *
 * Which outcomes count is a claim about the *stored graph*, not about this
 * request: `synced` wrote it, `fresh` means somebody else's refresh wrote it
 * while this caller queued, and `cooldown` means one landed within the last few
 * seconds — in all three the reader may be holding an answer from before it.
 * `locked` is a refresh still running (there is nothing new to read yet, and the
 * reader's next press is the retry), `gone` moves a tombstone the panel does not
 * read, and `failed` wrote nothing at all.
 */
function invalidateAfterRefresh(
  queryClient: QueryClient,
  leagueId: string,
  result: LeagueSyncPayload,
): void {
  const wrote =
    result.synced || result.status === "cooldown";
  if (!wrote) return;

  // The league *prefix*, so all four of this league's entries go with it — the
  // core rosters, the prices on every board, the outlook and every week. None of
  // them is re-derivable from a graph that has just changed underneath it, and
  // addressing the prefix is what keeps that true as entries are added: the
  // split into four cost this line nothing.
  void queryClient.invalidateQueries({
    queryKey: leagueQueryKeys.league(leagueId),
  });
  void queryClient.invalidateQueries({ queryKey: lineupQueryKeys.all });
}
