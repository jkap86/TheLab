// Types only from the catalogue, so nothing here is imported at runtime — the
// pure half of the comps page's debounce, tested under Node's runner without a
// renderer behind it.
import type { CompsPosition } from "../../shared/comps/fields.ts";

/**
 * When the board a request is built from is allowed to lag the board on screen.
 *
 * Weight and window edits are debounced: a drag across a slider is one request
 * rather than one per notch, and the rows already up stay up under an
 * "Updating…" note while it settles. That is right for an edit — the rows still
 * answer the player whose name is above them, on criteria the reader is in the
 * middle of changing.
 *
 * **It is wrong for a change of subject position, and the difference is not a
 * matter of degree.** A board is per position (`prefs.ts` says why: the fields
 * that matter to a receiver are not the ones that matter to a quarterback), so
 * picking a quarterback while a customized receiver board is settling used to
 * leave the two out of step for a beat — long enough to build and fire a
 * request pairing the new subject with the *previous position's* weights. What
 * comes back is a real answer to a question nobody asked: this quarterback's
 * comps, ranked on a receiver's board. It then lands in its own cache entry
 * under its own key, so it is not even transient — a reader who returns to that
 * combination is served it again.
 *
 * So the debounce covers exactly what it was for — edits *within* one position
 * — and a position change lands at once. That costs nothing: the new position's
 * board is either the catalogue's defaults or one the reader tuned earlier, and
 * neither is a value in flight.
 */

/** The board the page wants used, and the position it belongs to. */
export type CompsBoardTarget = {
  /** The subject's position, or null before a subject is picked. */
  position: CompsPosition | null;
  /**
   * The customized board, serialized — `""` for a position the reader has not
   * touched, which travels as no `fields=` at all and shares the default
   * board's cache entry.
   */
  boardKey: string;
};

/** How long an edit within one position is held before it re-keys the query. */
export const COMPS_BOARD_SETTLE_MS = 250;

/**
 * The board key a request should actually be built from.
 *
 * Settled where the settled board belongs to the position on screen, and the
 * live one the moment it doesn't — which is the whole fix, expressed as a
 * derivation rather than as a second piece of state. A value derived during
 * render cannot be a frame behind the state it is derived from, where an effect
 * that "catches up" always can.
 */
export function effectiveBoardKey(
  settled: CompsBoardTarget,
  target: CompsBoardTarget,
): string {
  return settled.position === target.position
    ? settled.boardKey
    : target.boardKey;
}

/**
 * Whether the request in flight (or on screen) is built from an older board
 * than the one the controls show — what the page dims and labels "Updating…".
 *
 * False through a position change by construction: nothing is lagging there,
 * because the effective board is the new position's already.
 */
export function boardSettlePending(
  settled: CompsBoardTarget,
  target: CompsBoardTarget,
): boolean {
  return effectiveBoardKey(settled, target) !== target.boardKey;
}

/**
 * How long to wait before adopting `target` as the settled board:
 * `null` for nothing to do, `0` to adopt it now, `ms` for an ordinary edit.
 *
 * Zero rather than "nothing to do" for a position change: the settled board
 * still has to *move*, or the next edit within the new position would be
 * debounced against a baseline belonging to the old one. It is only a baseline
 * — no request waits on it, because `effectiveBoardKey` has already switched
 * during render — so zero is a tick rather than a promise about a frame.
 */
export function boardSettleDelay(
  settled: CompsBoardTarget,
  target: CompsBoardTarget,
  ms: number = COMPS_BOARD_SETTLE_MS,
): number | null {
  if (settled.position !== target.position) return 0;
  return settled.boardKey === target.boardKey ? null : ms;
}
