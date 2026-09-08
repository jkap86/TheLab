"use client";

import { useEffect, useRef, useState } from "react";

import type { LineupColumn, ManagerLineupsPayload } from "@/shared/contract";
import {
  adpBoardsOf,
  ktcVariantsOf,
  lineupColumnKey,
  positionSetsOf,
  serializeAdpBoards,
  serializeKtcVariants,
  serializePositionSets,
  serializeSlotSets,
  serializeTeamTotalKeys,
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
  /**
   * What the expanded card's standings pane reads — a fifth column, and one
   * that asks a different question from the four.
   *
   * **The four bays want a rank and this wants a total per roster**, which is
   * why it is a parameter of its own rather than an entry in `columns`. Its
   * *axes* do join those four, because a forced market or a narrowing has to be
   * priced and re-totalled either way — but the total itself is only carried
   * out for the columns `?team_totals=` names, since the cross product of four
   * bays' axes over a dozen rosters is hundreds of sums a league where a pane
   * reads one.
   */
  teamsColumn: LineupColumn,
): ManagerLineupsPayload | null {
  const [payload, setPayload] = useState<ManagerLineupsPayload | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  /** Which subject has already spent its one retry — see `retryOnce`. */
  const retriedRef = useRef<string | null>(null);

  // Reset during render, the way `useManagerLeagues` does: a subject change
  // must not paint one frame of the previous manager's lineups.
  // **The teams column joins the four reductions**, which is what makes its
  // own totals answerable: a pricing it has forced has to be read for this
  // league and a narrowing it carries has to be re-totalled, and both of those
  // are decided by the *axes* the request names rather than by which column
  // named them. Its rank comes along for free and nothing reads it, which is
  // the same free ride a bay's ninth metric already takes.
  const asked = [...columns, teamsColumn];
  const boards = serializeKtcVariants(ktcVariantsOf(asked));
  const adpBoards = serializeAdpBoards(adpBoardsOf(asked));
  const positions = serializePositionSets(positionSetsOf(asked));
  const slots = serializeSlotSets(slotSetsOf(asked));
  // The one column whose totals are carried out per roster. A column on each
  // league's own board narrowing nothing folds to a bare metric id, which the
  // ten totals every entry already carries answer — so a reader who has never
  // opened the pane's picker sends a key that costs the route nothing.
  const teamTotals = serializeTeamTotalKeys([lineupColumnKey(teamsColumn)]);
  const subject = `${username} ${season ?? ""} ${boards} ${adpBoards} ${positions} ${slots} ${teamTotals}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setPayload(null);
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
      if (retriedRef.current === subject) return;
      retriedRef.current = subject;
      retry = setTimeout(() => setAttempt((n) => n + 1), LINEUPS_RETRY_MS);
    };

    const url =
      `/api/user/${encodeURIComponent(username)}/lineups` +
      `?season=${encodeURIComponent(season)}` +
      (boards ? `&ktc_boards=${encodeURIComponent(boards)}` : "") +
      (adpBoards ? `&adp_boards=${encodeURIComponent(adpBoards)}` : "") +
      (positions ? `&positions=${encodeURIComponent(positions)}` : "") +
      (slots ? `&slots=${encodeURIComponent(slots)}` : "") +
      (teamTotals ? `&team_totals=${encodeURIComponent(teamTotals)}` : "");

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
    // The five strings and not the columns: the arrays are new identities on
    // every render of the page above, where a string moves only when a bay's
    // market, QB board, position set or slot set does, or when the standings
    // pane's own column does — which are the only edits that cost a request.
    // `attempt` is the retry above, and `guard` is one object for the life of
    // the hook — see `useRequestGuard`.
  }, [
    username, season, ready, boards, adpBoards, positions, slots, teamTotals, attempt,
    guard, subject,
  ]);

  return payload;
}
