"use client";

import { useEffect, useRef, useState } from "react";

import type { LineupColumn, ManagerLineupsPayload } from "@/shared/contract";
import {
  adpBoardsOf,
  ktcVariantsOf,
  positionSetsOf,
  serializeAdpBoards,
  serializeKtcVariants,
  serializePositionSets,
  serializeSlotSets,
  slotSetsOf,
} from "@/shared/ktc/columns";
import { isAbortError, useRequestGuard } from "@/features/shared";

/**
 * How long a failed lineups read waits before its single retry.
 *
 * Long enough that a Sleeper or database blip has plausibly passed and short
 * enough that a reader still has the page open. There is exactly one of them
 * per subject, so this is a delay rather than an interval.
 */
const LINEUPS_RETRY_MS = 4000;

/** What {@link useManagerLineups} answers: the page's ranks, and whether it is
 * still trying to get them. */
export type ManagerLineupsState = {
  /** The page's ranks, or null before they land. */
  payload: ManagerLineupsPayload | null;
  /**
   * The read is in flight, or about to be — which is **not** the same question
   * as `payload === null`, and is why this is a field rather than a derivation
   * at the call site.
   *
   * Two states share that null. A read still running is one; a read that failed
   * twice and stopped is the other, and this hook swallows the failure by
   * design. While both drew an em dash the difference did not show; a *loading
   * indicator* is a claim, and one left bubbling behind a request that already
   * gave up is the thing the page's loading states must never do.
   *
   * **It is also a fact about the page rather than about a league**, which is
   * the second half of why it lives here. A rank window cannot ask "has my
   * league's answer arrived" and get this — `getManagerLeagues` lists a league
   * the manager was *chopped* out of (`FIELDED_A_TEAM_SQL`) where the lineups
   * query answers only for one they hold a roster in (`HOLDS_A_ROSTER_SQL`), so
   * a chopped league's entry is absent from a payload that landed perfectly and
   * always will be. Read per league, an indicator would run on that card until
   * the reader left the page.
   */
  pending: boolean;
};

/**
 * Read `GET /api/user/[username]/lineups` — one JSON answer for the whole page,
 * fetched beside the leagues stream rather than through it: the stream's job is
 * to arrive fast and show sync progress, and the lineup solve wants the synced
 * rosters that only exist once that work is done.
 *
 * `season` is the **resolved** season off the leagues stream, not the page's
 * raw query — both routes must price the same year, and sending the resolved
 * one keeps this request deterministic (see `parseRequestedSeason`).
 *
 * `ready` gates the fetch until the leagues have settled (`!refreshing` with
 * leagues on screen). It is also the refetch trigger: a cold sync flips it
 * false→true when it finishes, which is exactly when the rosters and drafts
 * this route reads came into existence.
 *
 * **`columns` reaches the request as the *narrowings* they need, not as
 * themselves.** A rank has to exist before it can be rendered and only the
 * server can compute one across a league's twelve rosters, so a column that has
 * forced a KeepTradeCut market or QB board is a board the server has to price,
 * and one narrowed to a set of positions is a second way to total the same
 * solved lineups; but the ten ranks on each league's own boards, un-narrowed,
 * always ship — so a column left on `auto` with no position set, which is every
 * column any reader held before those axes existed, is already answered.
 * `ktcVariantsOf`, `adpBoardsOf`, `positionSetsOf` and `slotSetsOf` are those
 * four reductions, and they are what keep adding a ROS tile, or reordering the rack,
 * free of a round trip. The middle one is the capital columns' half of the QB
 * board axis: draft capital has no market, but the ADP fold does split superflex
 * drafts from standard ones, so a capital bay can force a board exactly as a
 * KeepTradeCut one can and it costs the same single round trip.
 *
 * **All four therefore join the subject key**, so forcing a board or narrowing to a
 * position blanks the ranks for the one round trip instead of painting the old
 * narrowing's numbers under the new label — which is the failure that has no
 * symptom, since a rank is a plausible number whichever question produced it.
 * That is the same cost a season change already pays, and one request for the
 * whole page. (The trades board resolves its own board choice on the client,
 * because there the number is only printed — see that route for the argument.)
 *
 * A failure resolves to null and the cards simply omit the section — the
 * lineup is an enhancement beside the list, not the list, so it degrades the
 * way the refresh note does rather than replacing the page. **It gets one
 * retry**, because the dependency list that makes this cheap also latched it:
 * `ready` flips true once and the four strings move only when a reader edits a
 * bay, so a request lost to a blip left every rank window on an em dash with
 * nothing that would ever ask again. See `LINEUPS_RETRY_MS`.
 */
export function useManagerLineups(
  username: string,
  season: string | null,
  ready: boolean,
  columns: readonly LineupColumn[],
): ManagerLineupsState {
  const [payload, setPayload] = useState<ManagerLineupsPayload | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  /** Which subject has already spent its one retry — see `retryOnce`. */
  const retriedRef = useRef<string | null>(null);
  /**
   * The subject whose *second* attempt failed, so nothing more is coming.
   *
   * Keyed by subject rather than a boolean so a later question is pending
   * again: a reader whose read failed twice and then changed manager would
   * otherwise never see the page claim to be reading again.
   */
  const [failedSubject, setFailedSubject] = useState<string | null>(null);

  // Reset during render, the way `useManagerLeagues` does: a manager change
  // must not paint one frame of the previous manager's lineups.
  //
  // **The four bays and nothing else.** The standings pane's own column used to
  // join these reductions, because its per-roster totals rode this payload;
  // they ride the expanded card's own per-league read now (`useLeagueLineup`),
  // so a reader changing what that pane is sorted by no longer re-asks a
  // hundred leagues for their ranks.
  const boards = serializeKtcVariants(ktcVariantsOf(columns));
  const adpBoards = serializeAdpBoards(adpBoardsOf(columns));
  const positions = serializePositionSets(positionSetsOf(columns));
  const slots = serializeSlotSets(slotSetsOf(columns));
  const subject = `${username} ${season ?? ""} ${boards} ${adpBoards} ${positions} ${slots}`;
  /**
   * The half of the subject a stale answer would be *wrong* about.
   *
   * **Only a manager or a season change blanks the payload.** Those name which
   * data the page is about, so last manager's ranks under this one's name is a
   * wrong number rather than an old one. None of the four reductions above is:
   * every rank is filed under `lineupColumnKey`, so a bay edit asks for a key
   * the held payload simply does not carry, and that one window reads an em
   * dash until the answer lands. Blanking for it took all of a hundred-league
   * page's rank windows down for a round trip to change one tile.
   */
  const identity = `${username} ${season ?? ""}`;
  const [renderedIdentity, setRenderedIdentity] = useState(identity);
  if (renderedIdentity !== identity) {
    setRenderedIdentity(identity);
    setPayload(null);
  }

  // A subject that has changed has not failed — it has not been asked yet.
  //
  // Adjusting state during render for a changed input is the pattern React
  // documents and the one the identity reset above already uses; doing it in
  // the effect instead is the cascading render `react-hooks/set-state-in-effect`
  // exists to stop. It is keyed on the *whole* subject rather than on the
  // identity, because a bay edit re-fires the request too — so a reader who
  // forced a board after a failure gets a page that says it is reading again.
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setFailedSubject(null);
  }

  // The reset above runs during render and the effect's cleanup runs after
  // paint, so a response for the previous subject can still resolve in between
  // — past the abort and past the `isAbortError` guard — and write one
  // manager's ranks under another manager's name. A rank is a plausible number
  // whichever question produced it, which is what makes this the failure with
  // no symptom. See `request-guard`.
  const guard = useRequestGuard(subject);

  /**
   * Bumped to re-run the effect for the *same* subject, which is the one thing
   * a dependency list cannot express: a transient failure needs another go, and
   * nothing about the manager, the season or the boards has changed.
   */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready || !season) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const ticket = guard.issue();
    /**
     * One retry per request, and only for a request that failed.
     *
     * **Not polling**: it is a single timer, cancelled by the cleanup below on
     * unmount, on a subject change and on the retry itself, and a second
     * failure is where it stops. What it fixes is a hook that was latched by
     * its own dependency list — `ready` flips true once, the boards move only
     * when a reader edits a bay, so a lineups request lost to a blip left the
     * page's ten rank windows on em dashes until something unrelated happened.
     * The UX stays what it was, deliberately: a lineup is an enhancement beside
     * the list, so a failure has no error surface and this is how it recovers
     * without one.
     */
    let retry: ReturnType<typeof setTimeout> | null = null;
    const retryOnce = () => {
      if (retriedRef.current === subject) {
        // The retry is spent, so nothing further is coming for this subject.
        // What that buys the page is the difference between a rank window that
        // is waiting and one that has stopped — see `ManagerLineupsState`.
        setFailedSubject(subject);
        return;
      }
      retriedRef.current = subject;
      retry = setTimeout(() => setAttempt((n) => n + 1), LINEUPS_RETRY_MS);
    };

    const url =
      `/api/user/${encodeURIComponent(username)}/lineups` +
      `?season=${encodeURIComponent(season)}` +
      (boards ? `&ktc_boards=${encodeURIComponent(boards)}` : "") +
      (adpBoards ? `&adp_boards=${encodeURIComponent(adpBoards)}` : "") +
      (positions ? `&positions=${encodeURIComponent(positions)}` : "") +
      (slots ? `&slots=${encodeURIComponent(slots)}` : "");

    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          if (guard.accepts(ticket)) retryOnce();
          return;
        }
        const body = (await res.json()) as ManagerLineupsPayload;
        // The ticket, not the abort: the abort has not necessarily fired yet.
        if (!guard.accepts(ticket)) return;
        setPayload(body);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        // Degraded, not broken — see the hook note.
        if (guard.accepts(ticket)) retryOnce();
      }
    })();

    return () => {
      controller.abort();
      if (retry !== null) clearTimeout(retry);
    };
    // The four strings and not the columns: the arrays are new identities on
    // every render of the page above, where a string moves only when a bay's
    // market, QB board, position set or slot set does — which are the only
    // edits that cost a request. `attempt` is the retry above, and `guard` is
    // one object for the life of the hook — see `useRequestGuard`.
  }, [
    username, season, ready, boards, adpBoards, positions, slots, attempt,
    guard, subject,
  ]);

  return {
    payload,
    // Not `payload === null`: a read that has given up is not one still
    // running, and a league the payload legitimately omits is neither. See
    // {@link ManagerLineupsState.pending}.
    pending: payload === null && failedSubject !== subject,
  };
}
