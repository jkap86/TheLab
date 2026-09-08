/**
 * Where an open card parks, and how much of the screen its expanded panel
 * takes once it has.
 *
 * **The arithmetic is pure and tested**, which is why it is a `.ts` of its own
 * rather than something the components work out between themselves: every term
 * here is a measurement a caller takes, and the sums between them are the thing
 * that renders perfectly while being wrong. A cap 500px too small is a panel
 * with a scroller in it and no error to say so.
 *
 * **Two DOM reads sit beside it, deliberately.** {@link measureFreezeTop} is
 * there because two modules ask where a card parks — the list, which sizes the
 * shell, and the panel, which sizes itself inside it — and a second spelling of
 * that offset is the drift this whole module exists to prevent: the shell would
 * start at one line and the panel would size against another, and the
 * difference would be a strip of clipped card. It reads through
 * {@link freezeTopFrom}, which is pure and is what the test drives, so the
 * arithmetic stays reachable from Node's own runner while the measurement has
 * exactly one home. {@link prefersReducedMotion} is there for the same reason
 * one grain over: three of the durations declared here are spent only when it
 * is false, and three places asking the platform the same question separately
 * is three chances for one of them to keep moving.
 *
 * **Every card parks now**, which is what this module lost in the change: it
 * used to carry a second arm for the trade card, which neither scrolled itself
 * into place nor froze its header, and whose cap was therefore a share of the
 * viewport rather than what was left under a header that was not there. With
 * the list itself standing down around an open card there is no such thing as
 * an un-parked one, and `MIN_UNPARKED`, `UNPARKED_SHARE` and `UNPARKED_MARGIN`
 * went with it. What the trade card's much taller header costs it is the floor
 * below — see {@link panelFit}.
 */

/**
 * How far a card's plate hangs above the card's own top edge.
 *
 * **The plate is what has to clear the rack, not the housing**, since the plate
 * is what the league's name is on — so it is a term in the park offset, and it
 * is the list's own top padding while parked. The parked shell clips
 * (`overflow`), and a shell that started at the housing's line would take the
 * top third off every league's name.
 */
export const PLATE_OVERHANG = 13;

/** Between the rack's underside and the plate's top. */
export const RACK_BREATH = 6;

/**
 * Under the parked shell, so the card's foot does not sit flush against the
 * fold.
 */
export const SHELL_BREATH = 16;

/**
 * The card's flight: how long it takes to reach the park line, and to come
 * back.
 *
 * **It is a transform on one card, not a scroll of the page.** The page used to
 * be walked to the card over this time and the list stood down at the end of
 * it, which put the list's own layout — hiding a hundred cards, then showing
 * them again — *inside* the animation. Measured on a hundred-card fixture:
 * 139ms of blocked main thread landing at +283ms and +361ms of a 340ms walk,
 * and the same again on the way back, so the motion ran at about six frames.
 * The park is one discrete layout and cannot be made cheap, so it happens once,
 * on the press, and the card is flown from where it was to where it now is —
 * compositor work, which no amount of list is able to block.
 *
 * **600ms is a chosen feel, not a measurement.** Lengthening it costs nothing —
 * the park it follows is already done and the flight itself is one transform —
 * so the number buys how long the card takes to travel and nothing else.
 */
export const FLIGHT_MS = 600;
export const FLIGHT_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * The panel's reveal on open, and its collapse on close.
 *
 * **Neither moves a box, and that is what makes them smooth.** The unfold used
 * to grow `max-height` from nothing, which re-laid the panel's own subtree — a
 * twelve-team browser is ~490 nodes — on every frame, so it ran at about six
 * frames however short its duration was. Nothing needs to watch it grow: the
 * only thing under an opening card is the rest of the list, and the park has
 * already taken that off the screen. So the panel stands at its final size from
 * its first frame, and both directions are opacity, a small rise and a clip —
 * all of which the compositor owns.
 *
 * **600ms each, on the flight's argument: neither length is a measurement.**
 * What a longer one spends is the reader's time before the panel settles and
 * before a closing card lets go, rather than any work. Keep
 * `COLLAPSE_MS` and the collapse animation one number — it is also the timer
 * that shuts the disclosure, so a shorter timer would cut the sweep off and a
 * longer one would leave a finished card on screen.
 */
export const EXPAND_MS = 600;
export const EXPAND_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const COLLAPSE_MS = 600;
export const COLLAPSE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * The floor: **what the panel's own parts need, not a round number.** The
 * history bay is ~72px with its margin, a pane's ledge ~62, and the roster
 * pane's two pinned bars 88 — so under about 320px the glass is shorter than
 * the bars standing on it and the drawer has nowhere to open.
 *
 * Below it the panel is simply taller than the room it was given and the
 * **shell** scrolls, which is the behaviour the cap replaces and is the right
 * thing to fall back to: a capped panel that cannot show a row is worse than an
 * uncapped one. It is the one thing a trade card, whose summary carries both
 * hauls in full, reaches on an ordinary laptop where a league card does not.
 */
export const MIN_PARKED = 320;

/**
 * What the measurement falls back to where there is no rack to measure — a card
 * rendered outside the app shell, or a test. Nothing else reads it.
 *
 * **It is `--card-freeze-top`'s last value, and that token is gone**, because
 * this is now the only place the number lives. Its history is the argument for
 * measuring rather than compiling it in, and is worth keeping: it was 4.625rem
 * when it counted the rack and a little breath alone, which parked the plate's
 * top edge at 61px against a 62px rack — the league's name a pixel *behind* the
 * thing the offset exists to keep it clear of. It went to 5.875rem while the
 * manager card wore a milled billet ledge, whose overhang is 20px rather than a
 * plate's 13, and back to 5.4375rem when the ledge came off. Twice wrong and
 * once merely stale, all three times because the rack or the card moved and a
 * constant did not.
 *
 * The figure itself is the `md` rack with no Browse track in it: 62 + 13 + 12.
 * Both pages whose cards park *do* carry a track, which makes their rack 65.1 —
 * so even as a fallback it is a little tight, which is the last of the argument
 * for {@link measureFreezeTop}.
 */
export const FREEZE_TOP_FALLBACK = 87;

/**
 * The park offset: where an open card's own top edge sits, in px from the
 * viewport's.
 *
 * **Measured off the rack rather than compiled in.** The rack is one row at
 * every width but not one height — 50, 52 and 62px across its three arms — and
 * a card parked against a number the rack has since moved off is either a plate
 * under the rack or a gap nobody asked for.
 */
export function freezeTopFrom(rackBottom: number | null): number {
  if (rackBottom === null || !Number.isFinite(rackBottom)) {
    return FREEZE_TOP_FALLBACK;
  }
  return Math.round(rackBottom + RACK_BREATH + PLATE_OVERHANG);
}

/**
 * {@link freezeTopFrom} against the rack that is actually on screen.
 *
 * The rack carries `data-app-rack` for this and for nothing else; it is
 * `fixed`, so its `bottom` is a viewport coordinate and needs no scroll term.
 */
export function measureFreezeTop(): number {
  if (typeof document === "undefined") return FREEZE_TOP_FALLBACK;
  const rack = document.querySelector("[data-app-rack]");
  return freezeTopFrom(rack ? rack.getBoundingClientRect().bottom : null);
}

/**
 * Whether the reader has asked for less motion.
 *
 * **The park and the collapse are both motion the stylesheet cannot reach.**
 * `.lab-anim`'s rule clears `transition` and `animation`, which covers every
 * other moving thing on a card — but the collapse is a Web Animations object
 * and the park is a `scrollTo`, and neither is a CSS property to be cleared. So
 * the two ask here and spend their durations on the answer: an instant scroll
 * and an instant collapse, with everything else about the behaviour identical.
 * The card still parks, the list still stands down, the URL still changes.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The parked shell's box: where the list starts, and how tall it is. */
export type ParkedShell = {
  /**
   * The list's own top, which is the **plate's** line rather than the card's:
   * the shell carries the overhang as its own padding, so the plate is inside
   * the box that clips instead of hanging out of it.
   */
  top: number;
  /** Its height — the rest of the viewport, less a little breath. */
  height: number;
};

export function parkedShell(viewport: number, freezeTop: number): ParkedShell {
  const top = Math.round(freezeTop - PLATE_OVERHANG);
  return { top, height: Math.max(0, Math.round(viewport - top - SHELL_BREATH)) };
}

/**
 * What is left under the panel's own top edge, inside a shell of this height.
 *
 * `panelOffset` is how far the panel's top sits below the card's — the header's
 * height *and* the panel's margin above it, measured as one distance rather
 * than summed from two. A margin read separately is a second number to keep in
 * step with a stylesheet, and the symptom of getting it wrong is a panel that
 * overhangs the fold by exactly that margin.
 */
export function panelRoom(shellHeight: number, panelOffset: number): number {
  return Math.round(shellHeight - PLATE_OVERHANG - panelOffset);
}

/** How the panel is sized into the room it was given. */
export type PanelFit = {
  /**
   * **A max-height, never a height.** The panel is a flex item of the card's
   * own column, so a `height` loses to the flex algorithm and the box silently
   * keeps its content size; a max clamps it whatever flex decides.
   */
  cap: number;
  /**
   * The floor, **and only where the room is under it**. Spent otherwise it
   * would hold the panel taller than the space it is in and make the collapse
   * open with a jump before it moved.
   */
  minHeight: number;
  /** Whether the room is under the floor, so the shell has to scroll. */
  floored: boolean;
};

export function panelFit(room: number): PanelFit {
  const floored = room < MIN_PARKED;
  return {
    cap: Math.round(floored ? MIN_PARKED : room),
    minHeight: floored ? MIN_PARKED : 0,
    floored,
  };
}
