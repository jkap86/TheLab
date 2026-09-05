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
 * **A locked player is not a choice, at either end.** A seat whose game has
 * kicked off offers nothing — the pane says so rather than listing moves
 * Sleeper would refuse — and a locked player on the bench is out of the pool
 * for every *other* seat too, which is the contract's own wording.
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
  /** He is the seat's current holder, and is chipped rather than offered. */
  inSeat: boolean;
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

/** A seat's gap to the same seat opposite, as the meter draws it. */
export type SeatGap = {
  /** This seat less the one opposite. Null where either has no figure. */
  delta: number | null;
  /** How much of the track to fill, 0–100. Zero where there is no gap. */
  fill: number;
  /** Which side leads it, and therefore which of the two tracks fills. */
  lead: "mine" | "theirs" | null;
};

/**
 * Seat-level gaps are small beside the seat's own scale — a three-point edge
 * at a flex is a real result and 3% of a 44px track is a sliver — so the bar is
 * drawn against a fraction of the span rather than against the whole of it.
 * The clamp at 100 is what stops the widest gap in a lopsided week from
 * overflowing its track. The same figure `seat-compare` draws its bars at, and
 * deliberately: two grains of the same comparison on two pages.
 */
const GAP_SCALE = 1.4;

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
 * `span` is the larger of the two figures rather than the whole pane's, so a
 * gap at quarterback and a gap at a kicker are not drawn on one yardstick. The
 * floor of 1 is only ever reached where both sides are zero, and a zero gap
 * draws nothing anyway.
 */
export function seatGap(
  mine: LineupCheckSeat,
  theirs: LineupCheckSeat | undefined,
): SeatGap {
  const a = theirs === undefined ? null : seatPoints(mine);
  const b = theirs === undefined ? null : seatPoints(theirs);
  if (a === null || b === null) return { delta: null, fill: 0, lead: null };

  const delta = a - b;
  const span = Math.max(1, a, b);
  return {
    delta,
    fill:
      delta === 0
        ? 0
        : Math.min(100, Math.round((Math.abs(delta) / span) * GAP_SCALE * 100)),
    lead: delta > 0 ? "mine" : delta < 0 ? "theirs" : null,
  };
}

/**
 * Everyone on this roster who may legally sit in this seat, best first, with
 * the current holder among them.
 *
 * **The holder is always listed and never filtered**, whatever his positions
 * say: he is in the seat, and a list that omitted him would be answering a
 * different question from the one the header asks. He is chipped rather than
 * offered — `inSeat` — and carries no delta against himself.
 *
 * **A locked seat has no options at all**, which is the whole reason the pane
 * has a second state: his game has kicked off, Sleeper will refuse the move,
 * and an empty list under a note naming him is the honest answer where a list
 * of alternatives is a lie the reader would act on.
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

  const alternatives = bench
    // A player whose own game has kicked off is out of the pool for every seat
    // — the contract's wording, and the same rule that empties a locked seat.
    .filter((player) => !player.locked && seatTakes(seat.slot, player.positions))
    .filter((player) => player.player_id !== held?.player_id)
    .map((player): SeatOption => ({
      player,
      inSeat: false,
      delta:
        anchor === null || player.points === null ? null : player.points - anchor,
    }));

  const pool = held
    ? [{ player: held, inSeat: true, delta: null } as SeatOption, ...alternatives]
    : alternatives;

  return pool.sort(byProjection);
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
