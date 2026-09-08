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
 * The smooth scroll's own settle: how long after a press the list stands down.
 *
 * It is a wait rather than a `scrollend` listener because the scroll may have
 * nowhere to go — a card already at the offset gets no scroll and therefore no
 * event — and a park that never happened is worse than one that happened a
 * frame early.
 */
export const PARK_SETTLE_MS = 340;

/**
 * The panel's unfold on open, and its collapse on close.
 *
 * **The two are different animations and not one reversed**, and the reason is
 * what each has to move. The unfold grows the panel's *box* — the cards under
 * it slide down as it takes its room, and the opacity ramp hides the first few
 * frames, in which a housing forty pixels tall is laying out a rail, two ledges
 * and a pair of pinned bars on top of each other. The collapse moves no box at
 * all: the panel keeps its laid-out height and a clip sweeps its bottom edge up
 * under the summary while it fades, which runs on the compositor and never
 * re-solves the two panes. A max-height fold re-laid a twelve-team table on
 * every frame and the pinned bars rode its edge up; measured, that was the
 * roughness a reader saw as the collapse rather than the cut after it.
 *
 * Both are a little longer than the 260ms the collapse used to run: a panel
 * most of a screen tall folding in a quarter of a second reads as vanishing.
 */
export const EXPAND_MS = 320;
export const EXPAND_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const COLLAPSE_MS = 300;
export const COLLAPSE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * How long the rest of the page takes to stand down around a card, and to come
 * back around it.
 *
 * The stand-down runs inside the settle, so it is shorter than `PARK_SETTLE_MS`
 * by a margin: the other cards and the header are already gone when the list
 * becomes the shell and they go `display: none`, which is what turns that cut
 * into nothing a reader can see. The return runs over the walk back to where
 * the reader pressed, and is the same length as it.
 */
export const STAND_DOWN_MS = 240;
export const STAND_BACK_MS = 360;

/**
 * The scroll's own curve, for the walk into place and the walk back.
 *
 * A function rather than `behavior: "smooth"`, and the difference is a bug that
 * has no symptom: the browser clamps a smooth scroll's destination to the
 * document *as it stands when the call is made*. On a press the panel is still
 * unfolding, so a card near the foot of the page asks for a line the document
 * cannot yet reach, the scroll stops short, and the park then snaps the card
 * the rest of the way. Driven a frame at a time against a destination re-read
 * each frame, the walk lands where the card actually is.
 */
export function scrollEase(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

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
