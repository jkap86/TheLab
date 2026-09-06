import type { LeagueTeam, LineupPlayer } from "@/shared/contract";

// Relative with an extension: this module runs under Node's own test runner,
// which resolves neither the alias nor a bare specifier.
import { median } from "./rank-ramp.ts";

/**
 * A seat, as a comparison: what the team on screen has there, what the reader
 * has there, and the gap between the two.
 *
 * The expanded card's right pane used to be one roster read on its own, which
 * made picking a team on the left read as "a different roster" rather than as
 * "how do I stand against them". This is the arithmetic that turns it into the
 * second, and it lives here — pure, under Node's own runner — because every
 * decision in it is silent when it goes wrong: a gap drawn on the wrong side, a
 * bar scaled against the wrong span, or a null scored as a zero all render
 * perfectly and say something untrue.
 *
 * It is computed by `LeagueTeams` rather than by the breakdown below it,
 * because it is the component that can see *every* team: the ghost column, the
 * seat's own scale and the "best in league" reading all need the whole entry.
 */

/**
 * The three figures a solved roster can be read on. A type here rather than in
 * the component, so the comparison can be tested without React — the runtime
 * list (`LENSES`) and the labels stay with the keys that draw them.
 */
export type Lens = "points" | "capital" | "ktc";

/**
 * What one lens reads off a player. **Null is not zero, in all three** — an
 * unprojected stash, a player no synced draft priced, and one off KeepTradeCut's
 * board are each an absent answer rather than a worthless one, which is what
 * every rule below turns on.
 */
export function lensValue(
  player: LineupPlayer | null | undefined,
  lens: Lens,
): number | null {
  if (!player) return null;
  if (lens === "points") return player.points;
  if (lens === "capital") return player.adp_value;
  return player.ktc_value;
}

/**
 * Seat-level gaps are small beside the seat's own scale — a 3-point edge at a
 * flex is a real result and 3% of a full track is a sliver — so the bar is
 * drawn against a fraction of the span rather than against the whole of it.
 * The clamp at 100 is what stops the widest gap in a lopsided league from
 * overflowing its track.
 */
const GAP_SCALE = 1.4;

/**
 * The league's median figure at each starting seat, index-aligned with any
 * roster's `starters`.
 *
 * **This is what a seat's figure is coloured against**, and the choice of
 * comparison is the whole reason the colour is worth printing at all. Read on
 * its own magnitude a quarterback would be green in every league and a kicker
 * red in every league, because the two are not on one scale and never were.
 * Read against the twelve rosters' *middle player at that same seat*, a green
 * QB1 is one that actually beats the league's and a red one is a hole to fix —
 * which is a statement about the roster rather than about the position.
 *
 * **Seats are matched by index**, on {@link seatComparisons}' own rule and for
 * its reason: `roster_positions` is the league's own starting lineup and is
 * identical across every roster in it, so `starters[i]` is the same seat on
 * every team — and a league running two `RB` slots takes RB1's median from
 * every team's RB1.
 *
 * **A null is left out rather than counted as zero**, the rule every field
 * this reads is documented by. An unprojected stash, a player no synced draft
 * priced and one off KeepTradeCut's board are absent answers, and folding them
 * in as zeroes would drag every median toward the floor — colouring half a
 * league's seats green against a middle nobody occupies. A seat no roster has
 * a figure for comes back **0**, which `slotPercentile` reads as "nothing to
 * compare against" and draws neutral.
 *
 * Derived in the browser from the entry the page already holds — a second read
 * of data in hand, not a second request.
 */
export function slotMedians(
  teams: readonly LeagueTeam[],
  seats: number,
  lens: Lens,
): number[] {
  return Array.from({ length: seats }, (_, i) => {
    const across = teams
      .map((team) => lensValue(team.lineup.starters[i]?.player, lens))
      .filter((value): value is number => value !== null);
    return median(across);
  });
}

export type SeatCompare = {
  /**
   * The figure in the ghost column: the reader's own player at this seat, or —
   * when their own team is the one on screen, and there is therefore nothing to
   * compare it to — the best figure any team in the league has there.
   */
  ghost: number | null;
  /**
   * The team on screen less the ghost, signed the way the standings' own Gap
   * column is: it describes the figure the reader is looking at, not the reader.
   * **Null where either side is null**, which is a different answer from zero —
   * see the note on `standing`.
   */
  delta: number | null;
  /** How much of the gap track to fill, 0–100. Zero where there is no gap to draw. */
  fill: number;
  /**
   * The same gap from the *reader's* side, which is what its colour is about:
   * green where they lead the seat, red where they trail it.
   *
   * **Null covers two cases and draws neither**: level, and nothing to compare.
   * Scoring an unpriced player as zero would hand the other side a maximal,
   * full-length lead on a row whose own figures say there is nothing to compare
   * — and, being the largest number in the column, it would set the span and
   * squeeze every real gap in the pane into a sliver.
   */
  standing: "ahead" | "behind" | null;
};

/**
 * One comparison per seat of the roster on screen, index-aligned with its
 * starters.
 *
 * **Seats are matched by index, not by slot name.** `roster_positions` is the
 * league's own starting lineup and is identical across every roster in it, so
 * `starters[i]` is the same seat on every team — which is also what makes a
 * league with repeated slots compare RB1 to RB1 and RB2 to RB2.
 *
 * @param teams every stored roster in the league — the seat's scale and the
 *   league's best at it are read across all of them, the selected team included.
 * @param manager the reader's own team, or null/absent where they hold none.
 */
export function seatComparisons(
  teams: readonly LeagueTeam[],
  selected: LeagueTeam,
  manager: LeagueTeam | null | undefined,
  lens: Lens,
): SeatCompare[] {
  // Their own team on screen has nothing to be compared against, so the ghost
  // becomes the league's best at each seat — and the pane's header says so.
  const mirror = !manager || manager.roster_id === selected.roster_id;

  return selected.lineup.starters.map((seat, i) => {
    const shown = lensValue(seat.player, lens);
    const across = teams
      .map((team) => lensValue(team.lineup.starters[i]?.player, lens))
      .filter((value): value is number => value !== null);
    const ghost = mirror
      ? across.length > 0
        ? Math.max(...across)
        : null
      : lensValue(manager?.lineup.starters[i]?.player, lens);

    if (shown === null || ghost === null) {
      return { ghost, delta: null, fill: 0, standing: null };
    }

    const delta = shown - ghost;
    // Against the seat's own scale, so a gap at quarterback and a gap at a
    // kicker are not drawn on the same yardstick. The floor of 1 is only ever
    // reached where every figure at the seat is zero, and a zero gap draws
    // nothing anyway.
    const span = Math.max(1, ...across);
    const fill = Math.min(
      100,
      Math.round((Math.abs(delta) / span) * GAP_SCALE * 100),
    );
    // Mirrored, the roster on screen *is* the reader's, so the sign already
    // reads from their side; otherwise it reads from their opponent's.
    const reader = mirror ? delta : -delta;
    return {
      ghost,
      delta,
      fill: reader === 0 ? 0 : fill,
      standing: reader > 0 ? "ahead" : reader < 0 ? "behind" : null,
    };
  });
}
