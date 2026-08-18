// Types only, so nothing here is imported at runtime — the pure half of
// `hooks/use-comps.ts`, tested under Node's runner without React Query behind
// it.
import type { CompsPayload } from "./types.ts";

/**
 * What the comps tool draws from one React Query entry, and the one rule that
 * needs stating: **a held payload may answer an older comparison, never an
 * older player.**
 *
 * `keepPreviousData` is what stops the list blanking on every re-key, which is
 * the right trade while the subject is fixed — changing a weight, a window, the
 * basis or the season leaves the rows about the player whose name is above
 * them, and the caller dims them under "Updating…". A change of *subject* is a
 * different thing: the heading is state and updates on the press, while the
 * payload is a fetch and lags it, so for a beat the previous player's comps sat
 * under the new player's name with nothing on screen saying so. That is not
 * staleness, it is a false claim, and it is what this fold withholds.
 */
export type CompsState = {
  data: CompsPayload | null;
  error: string | null;
  loading: boolean;
  /**
   * The rows in `data` answer a *previous* selection, held on screen by
   * `keepPreviousData` while the new one loads — the `useAdp` flag, for the
   * same reason: the one dishonest state is old rows passing as the new
   * weights' answer, so the caller dims them and says "Updating…". Never true
   * where `data` is null: nothing withheld is on screen to be stale.
   */
  stale: boolean;
};

/** The query entry as this fold reads it — React Query's fields, narrowed. */
export type CompsQuerySnapshot = {
  data: CompsPayload | null | undefined;
  error: string | null;
  isFetching: boolean;
  isPlaceholderData: boolean;
};

/**
 * The entry folded into what the page draws, with `subjectId` the player the
 * page is *currently* naming. A payload describing anyone else is withheld —
 * matched on the answer's own `subject.player_id`, which is the only thing that
 * knows whose comps a payload holds. A null `subjectId` holds whatever arrives:
 * there is no claim on screen for it to contradict.
 */
export function compsState(
  snapshot: CompsQuerySnapshot,
  subjectId: string | null,
): CompsState {
  const payload = snapshot.data ?? null;
  const answersSubject =
    payload === null ||
    subjectId === null ||
    payload.subject.player_id === subjectId;

  return {
    data: answersSubject ? payload : null,
    error: snapshot.error,
    loading: snapshot.isFetching,
    stale: answersSubject && snapshot.isPlaceholderData,
  };
}
