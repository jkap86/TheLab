import type { LineupCheckPlayer, LineupCheckSeat } from "@/shared/contract";

import { SLOT_POSITIONS } from "../../../shared/projections/slots.ts";

/**
 * The week view's two pieces of arithmetic: what a seat is worth against the
 * same seat opposite, and who else could legally sit in it.
 *
 * Pure, and the contract arrives as an erased `import type`, so this tests
 * under Node's own runner without a render behind it — the bar
 * `lineup-check-metrics.ts` beside it holds, and `features/shared/seat-compare`
 * before that. It is the same argument every one of them makes: a gap drawn on
 * the wrong side, a bar scaled against the wrong span, an ineligible player
 * offered as a choice and a null scored as a zero all render perfectly and say
 * something untrue.
 *
 * **Eligibility is the seat's, not the two players'.** A receiver is not a
 * candidate for a quarterback-only slot however good he is, and the vocabulary
 * that decides it is {@link SLOT_POSITIONS} — the app's own, the list the
 * solver seats from — rather than a table written here. The day the solver
 * learns Sleeper's `OP`, this offers it. An **unrecognised slot takes nobody**,
 * which is the call `compareLineup` already makes when it drops one into
 * `unknown_slots`: a build that does not know what a slot holds must not guess.
 *
 * **A locked *seat* offers nothing, and a locked *candidate* is still listed.**
 * The two halves used to be one rule and they are two questions. A seat whose
 * game has kicked off answers with the note and an empty list, because a list
 * of moves Sleeper would refuse is a claim the reader would act on. A locked
 * player on the bench stays on it, because his row carries a padlock saying
 * exactly why he cannot take the seat — where dropping him reads as a player
 * the app has lost. What is unchanged either way is the *solver's* pool: a
 * locked player is out of it for every other seat, which is the contract's own
 * wording and is `compareLineup`'s business rather than this list's.
 */

/** Which side of the game a pane is showing. */
export type Side = "mine" | "theirs";

/**
 * The seat a reader has pressed, or nothing.
 *
 * `side` is whose lineup was pressed and therefore **whose options are shown**
 * — not which pane shows them. The options land in the pane *opposite* the
 * press so the lineup being reasoned about never moves out from under it, and
 * the pane's header names the side rather than leaving it to position.
 *
 * It is per-card state. Opening a second league must not inherit the first's
 * pick: the index means nothing outside the lineup it was taken from.
 */
export type SeatPick = { side: Side; index: number };

/** One row of an options pane. */
export type SeatOption = {
  player: LineupCheckPlayer;
  /**
   * What seating him would gain or lose against whoever holds the seat now.
   *
   * **Null where the seat's own figure is unknown**, which is not zero — see
   * {@link seatPoints}. An option's own missing projection is null too, for the
   * reason `LineupCheckPlayer.points` gives: the feed has no row for him, and
   * a `+0.0` beside a name nobody projects is a number this page invented.
   */
  delta: number | null;
};

/**
 * What a seat is projected for, as a comparison reads it.
 *
 * **An empty seat is a real zero and an unpriced player is an absence**, which
 * is the contract's own `points` grammar one level up: null is "the feed has no
 * row at all", zero is "a row with no game". A slot Sleeper is carrying empty
 * is not a missing measurement — the lineup genuinely scores nothing there, and
 * `current_points` has already counted it that way — so it compares, and an
 * option's delta against it is that option's whole projection, which is exactly
 * the number a reader with an empty seat wants.
 *
 * That is the one place this parts company with `features/shared/seat-compare`,
 * which answers null for its own empty seat. The two are not the same question:
 * that pane reads a *season* lens, where an empty seat has no draft capital and
 * no market price to be zero of, and this one reads a week's points, which an
 * empty seat scores none of. Stated here rather than left to be noticed.
 */
export function seatPoints(seat: LineupCheckSeat): number | null {
  return seat.player === null ? 0 : seat.player.points;
}

/** Whether a slot will take a player at all — the seat's rule, not the pair's. */
export function seatTakes(slot: string, positions: readonly string[]): boolean {
  const allowed = SLOT_POSITIONS[slot];
  if (!allowed) return false;
  return positions.some((position) => allowed.includes(position));
}

/**
 * This seat against the same seat on the other roster.
 *
 * **Seats are matched by index, not by slot name**, and the caller does that
 * matching: `roster_positions` is the league's own starting lineup and both
 * lineups are solved from it, so `lineup[i]` is the same seat on both sides —
 * which is also what makes a league with two `RB` slots compare RB1 to RB1.
 *
 * **It is a bare delta now, where it used to be the meter's three numbers.**
 * The two-track gap column is gone — the row's figure is where the comparison
 * lives, inked by the ramp's two ends — so what a caller reads is the *sign*,
 * and the scaling that drew a bar against a fraction of the seat's own span
 * went with the bar. That argument is not lost: `features/shared/seat-compare`
 * carries the identical one for the manager card's seat rows, which still draw
 * meters, and this file has always cited it as the other grain of the same
 * comparison.
 */
export function seatGap(
  mine: LineupCheckSeat,
  theirs: LineupCheckSeat | undefined,
): number | null {
  const a = theirs === undefined ? null : seatPoints(mine);
  const b = theirs === undefined ? null : seatPoints(theirs);
  if (a === null || b === null) return null;
  return a - b;
}

/**
 * Everyone *else* on this roster who may legally sit in this seat, best first.
 *
 * **The holder is not on the list**, which reverses what this function used to
 * do and is the stronger reading: he was the first row, selected and chipped
 * `in seat`, and that row answers nothing — pressing his seat is what opened
 * the pane, and the lineup opposite is still showing him. Every delta here is
 * measured against his figure, which stays on screen throughout.
 *
 * **A locked candidate stays on the list**, which reverses the other half. He
 * was filtered out on the grounds that Sleeper will refuse the move; the
 * padlock in his bay says exactly that, where an absence reads as a player the
 * app has lost. What has not changed is the seat end of the same rule: **a
 * locked seat has no options at all**, because there the list itself would be
 * the lie — an empty list under a note naming him is the honest answer.
 *
 * The order is the bench's own — best first, an unprojected player last rather
 * than treated as the cheapest — and ties break on name so a pane does not
 * reshuffle between renders.
 */
export function seatOptions(
  seat: LineupCheckSeat,
  bench: readonly LineupCheckPlayer[],
): SeatOption[] {
  if (seat.player?.locked) return [];

  const held = seat.player;
  const anchor = seatPoints(seat);

  return bench
    .filter((player) => seatTakes(seat.slot, player.positions))
    .filter((player) => player.player_id !== held?.player_id)
    .map((player): SeatOption => ({
      player,
      delta:
        anchor === null || player.points === null ? null : player.points - anchor,
    }))
    .sort(byProjection);
}

/**
 * Best first, and **an unprojected player last in either direction**: the feed
 * having no row for him is not a reason to read him as the worst player on the
 * bench, but it is a reason not to put him at the top of a list of moves.
 */
function byProjection(a: SeatOption, b: SeatOption): number {
  const left = a.player.points;
  const right = b.player.points;
  if (left === null && right === null) return name(a).localeCompare(name(b));
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left || name(a).localeCompare(name(b));
}

/** What the pane calls him — the id where the feed has no name, as everywhere. */
function name(option: SeatOption): string {
  return option.player.name ?? option.player.player_id;
}
