"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import {
  COLLAPSE_EASE,
  COLLAPSE_MS,
  EXPAND_EASE,
  EXPAND_MS,
  measureFreezeTop,
  panelFit,
  panelRoom,
  parkedShell,
  prefersReducedMotion,
  type PanelFit,
} from "./panel-cap";

/**
 * Sizing an open card's expanded half into the parked shell, and collapsing it
 * again when the card closes.
 *
 * **A hook rather than a component**, which is what let the two shapes of
 * expanded half share one measurement: `/manager` and `/trades` mounted
 * {@link ExpandedPanel} and `/lineupchecker` a `CONSOLE_HOUSING_INSET` block
 * with a different inset. A component would have had to take a `className` for
 * the difference, and two base `p-*` utilities of the same specificity are
 * settled by Tailwind's emit order rather than the class attribute — the trap
 * `CONSOLE_CARD_SHELL` and `CONSOLE_KEY_PILL` are both split to keep a part out
 * of. **All three mount `ExpandedPanel` now**, since the checker's half
 * converged on the manager card's; the split stays because it is the seam a
 * fourth shape would take, and because a component that measures itself is a
 * component with a hook in it either way.
 *
 * **The room is measured off the shell, not computed from a chain of
 * constants.** While a card is parked the list is a box of known height with
 * the card inside it, so what is left under the panel's own top edge is one
 * subtraction of two rects — and being a subtraction of two rects it is
 * scroll-invariant, which the arithmetic form is not once the shell has to
 * scroll. The arithmetic is still here and is still exercised: it is what
 * answers during the ~340ms between a press and the park, when there is no
 * shell yet, and it is the same number, so the panel does not resize as the
 * list stands down around it.
 *
 * **The measurements are taken after layout, never guessed.** The header's
 * height changes with the settings strip's wrap, the league's name, the width
 * — and, since the summary readings fold, with a press: an open card's
 * standing and rank windows (or projection strip and checks) collapse over
 * 320ms and come back on the `Ranks` / `Checks` key, and the summary is
 * shorter by ~157px on a desktop for as long as they are folded. **That press
 * reaches this hook through the observer on the summary and nothing else**,
 * which is deliberate: the fold is a transition, so the summary's box moves a
 * little on every frame of it and the observer re-measures on each, landing
 * the last measurement on the transition's end — and a nonce bumped on the
 * press itself would measure a box that has not moved yet and buy nothing.
 * Under reduced motion the fold is one frame and the observer fires once. The
 * caller's `flex-none` while open is what makes any of it a measurement; see
 * below. A `100dvh` estimate is wrong on a phone the moment the URL bar
 * moves. So the cap is read on the frame after the open, and again whenever
 * that box changes size — a `ResizeObserver` on the summary, **and** a `resize`
 * listener beside it, because they are two events: the summary changes height
 * for reasons the window does not (a strip re-wrapping when a lens re-renders
 * it), and the window changes for reasons the summary does not. A window
 * dragged taller — or a phone's URL bar retracting — moves `innerHeight`
 * without moving the summary's box by a pixel, and the observer never fires.
 *
 * **The header must be at its natural height while the card is open, and that
 * is a requirement on the caller rather than a preference.** `offset` below is
 * `panel.offsetTop` — the header's own height — so a header that *grows* into
 * whatever the panel leaves makes the room a function of the panel's current
 * size and the measurement says nothing: every panel height is self-consistent,
 * and around {@link MIN_PARKED} two of them alternate forever (the floor is
 * applied, the panel grows to it, the room now reads at the floor, the floor is
 * dropped, the panel falls back, repeat). Driven at 1280x900 on a manager card
 * opened before its lineups had landed, that was a 60fps strobe between a 107px
 * panel under a 694px header and a 320px panel under a 481px one. All three
 * cards therefore pin their `<summary>` while open — `group-open/card:flex-none`
 * on the two league cards, `shrink-0` on the trades board's, which never grew.
 *
 * **React is the only writer of the panel's style**, which is the constraint
 * the collapse is arranged around: an inline value written from an event
 * handler is the same channel the render writes through, so a transition
 * declared on it races the next re-render. Every phase below is a render, the
 * transition is declared in the same style object as the value it carries, and
 * nothing outside this hook touches the box.
 */

/**
 * How the panel is being sized this frame.
 *
 * There is no intermediate "freeze" render, and **that is a correction rather
 * than a simplification.** A CSS transition needs its from-value to have been
 * painted, so collapsing with one meant rendering the panel frozen at its own
 * measured height, waiting a frame for that to land, and only then setting
 * zero — three renders, the last of them gated on a `requestAnimationFrame`.
 * Driven, the collapse began **330ms** after the press: rAF runs at whatever
 * rate the main thread allows, which under a headless renderer was ~11fps and
 * on a busy page is no better, and the 260ms timer that ends the close does not
 * wait for it. So the card sat still and then vanished.
 *
 * Both motions are {@link Animation}s instead: keyframes carry their own
 * from-value, so nothing has to be painted first and each starts in the layout
 * effect of the render that begins it. It also keeps the rule that made the
 * transition attractive — React stays the only writer of the panel's `style`,
 * and an animation runs in its own cascade origin above that style, so a
 * re-render mid-motion cannot clobber it.
 *
 * **The collapse does not move the box.** The `collapse` phase keeps the open
 * style — the cap, the floor, the flex — and the animation clips the panel's
 * bottom edge up under the summary while it fades. Folding `max-height`
 * instead re-solved the two panes on every frame, so the pinned bars rode the
 * edge up and a twelve-team table re-laid itself thirty times; a clip and an
 * opacity are compositor work and the contents stay exactly where they were.
 * Nothing under the panel needs the box to shrink: parked, the card is alone
 * in the shell, and inside the settle the cards below it are already fading
 * out (see `useActiveCard`). The animation fills forwards, because it ends a
 * frame or so before the timer that closes the disclosure and the panel must
 * not flash back for that frame.
 */
type Phase = "shut" | "open" | "collapse";

/** `useLayoutEffect` on the client, `useEffect` where there is no layout. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function usePanelCap<T extends HTMLElement>(
  /** Whether the card's disclosure is open — the panel is in the flow. */
  open: boolean,
  /** Whether it is closing: open for as long as the collapse takes. */
  closing: boolean,
): {
  ref: RefObject<T | null>;
  style: CSSProperties | undefined;
  /**
   * Whether the caller should render the panel's **contents**.
   *
   * **A closed card's expanded half must not be in the document**, and that is
   * a budget rather than a tidiness. A `<details>` hides its body rather than
   * unmounting it, so every card on the page was mounting a full twelve-team
   * browser to draw nothing: measured on a hundred-card fixture, **489 nodes a
   * card and 48,890 in the document**, against 13,090 with the closed ones
   * empty. Every style recalculation and every layout during the open and the
   * close walks that document, which is why the press blocked the main thread
   * for 255ms at a hundred cards and 59ms at twenty-five — a cost that scales
   * with the *list*, not with the card being opened, and the reason the
   * animation ran at about six frames.
   *
   * The deliberate cost is that the browser's own state — the selected team,
   * the lens, the metric column, an opened history rail — does not survive a
   * card being closed and reopened, and that the trade card's per-league read
   * is asked again on a second open (its route answers `private, max-age=60`,
   * so that is usually the browser's cache rather than the database). Both are
   * worth a document four times smaller.
   *
   * It stays mounted through the collapse, because the panel has to be on
   * screen for as long as it is animating off it.
   */
  mounted: boolean;
} {
  const ref = useRef<T | null>(null);
  const [fit, setFit] = useState<PanelFit | null>(null);
  /**
   * Whichever motion is driving the panel — the unfold or the collapse — so
   * the one that begins can stop the other. A card closed inside its own
   * unfold would otherwise have two animations on one element, and the
   * compositor would take the later one only for the properties it names.
   */
  const motion = useRef<Animation | null>(null);
  /**
   * Whether the panel was open on the last commit, which is what tells a
   * *press* from a mount: a card deeplinked open has nothing to unfold from,
   * and animating it from nothing would grow a panel the reader had already
   * asked for.
   */
  const wasOpen = useRef(open);

  /**
   * Re-read the room from the shell the card is standing in, and answer it.
   *
   * Cheap and idempotent — three rects and a `setState` React drops when the
   * number has not moved — because it runs from the observer as well as from
   * the open. It returns the fit as well as setting it, for the unfold, which
   * needs the target before the re-render that carries it.
   */
  const measure = useCallback((): PanelFit | null => {
    const panel = ref.current;
    const card = panel?.parentElement;
    if (!panel || !card) return null;

    // Everything of the card's height that is not the panel — the header, any
    // margin above the panel, and the housing's own top and bottom borders —
    // as one distance. Read separately, each is a second number to keep in
    // step with a stylesheet, and getting one wrong overhangs the fold by
    // exactly it.
    //
    // **This is only a measurement where the header is at its natural
    // height** — see the module note. A `flex-1` header inside the card's own
    // column absorbs the panel's slack, and then `panel.offsetTop` is the
    // panel's own size read back through the header, which is not information.
    //
    // **Layout metrics, never rects.** This was a subtraction of two
    // `getBoundingClientRect` tops, and that was right for as long as the card
    // element here (the `<details>`) carried no transform. It carries the
    // housing's tilt and lift now — the expanded-card pass moved the shell
    // onto it so the panel could sit inside the housing — and a rect is the
    // *projected* box: at `translateZ(20px)` under the list's 2400px
    // perspective every distance reads 0.84% long. Fed back through the flex
    // slack the summary absorbs, that was a cap shrinking by ~1px every frame
    // the `ResizeObserver` fired, and a header growing under the reader for
    // as long as the card stayed open. `offsetTop` and `clientTop` are
    // transform-free.
    //
    // `offsetTop` is relative to the panel's `offsetParent`, which is the
    // housing where the housing is positioned or transformed and the `<li>`
    // where it is neither (the lineup checker's card); the two share a top
    // edge, so the distance is the same either way, and `clientTop` adds the
    // housing's own top border in the first case and 0 in the second. The
    // bottom border is the rest of `offsetHeight` that `clientHeight` and the
    // top border do not account for.
    const offset =
      card.clientTop +
      panel.offsetTop +
      (card.offsetHeight - card.clientHeight - card.clientTop);

    let next: PanelFit;
    // **Parked is read off the stage, not off the list.** The list is marked
    // constantly (`data-card-list`) so the stylesheet can reach it without a
    // render; what says the shell is *standing* is the one attribute
    // `useActiveCard` writes on the `<main>`, which is also the only thing that
    // changes when the page parks.
    const shell = panel.closest("[data-card-list]");
    const parked =
      shell?.closest("main")?.getAttribute("data-card-stage") === "parked";
    if (parked && shell instanceof HTMLElement) {
      // `clientHeight` is the shell's content box, so it carries the plate's
      // overhang as padding — which is why that padding is subtracted here
      // rather than the constant: the shell is the one that set it, and this
      // reads back what it actually did.
      const pad = Number.parseFloat(getComputedStyle(shell).paddingTop) || 0;
      next = panelFit(Math.round(shell.clientHeight - pad - offset));
    } else {
      // No shell yet: the press has happened and the list has not stood down.
      // The same number, predicted, so the panel does not resize under the
      // park.
      const { height } = parkedShell(window.innerHeight, measureFreezeTop());
      next = panelFit(panelRoom(height, offset));
    }
    setFit(next);
    return next;
  }, []);

  /**
   * The first measurement, and the unfold — **before paint**.
   *
   * A layout effect rather than a frame later, and the difference was visible:
   * measured after paint, the panel stood at its full content height for a
   * frame and then snapped to the cap. Here `getBoundingClientRect` forces the
   * layout that has the panel in the flow, `setFit` re-renders synchronously
   * before the browser paints, and the unfold starts on the same frame the
   * disclosure opened.
   *
   * The unfold grows `max-height` from nothing to what the panel will actually
   * stand at — the content's own height under the cap, or the floor — so the
   * animation ends exactly where the style leaves it, with no jump at the end.
   * `min-height` rides along because a floored panel's floor would otherwise
   * win over an animated max from the first frame, and the box would not move.
   */
  useIsomorphicLayoutEffect(() => {
    const panel = ref.current;
    const arrived = open && !wasOpen.current;
    wasOpen.current = open;
    if (!open || !panel) return;

    // `measure()` runs before paint, so the cap lands on the same frame the
    // disclosure opened rather than a frame later — measured after paint, the
    // panel stood at its whole content height for a frame and then snapped to
    // the cap, which is a pop on every open.
    const next = measure();
    if (!arrived || !next) return;

    motion.current?.cancel();
    // **The box does not move, and that is the whole of it.** Growing
    // `max-height` re-laid the panel's own subtree on every frame — a
    // twelve-team browser is ~490 nodes — so the unfold ran at about six
    // frames however short its duration was. Nothing needs to watch it grow:
    // the only thing under an opening card is the rest of the list, which is
    // fading out and about to be `display: none`. So the panel stands at its
    // final size from the first frame and the reveal is opacity and a short
    // rise, which are compositor work and cannot be blocked by layout.
    const animation = panel.animate(
      [
        { opacity: 0, transform: "translateY(-8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: prefersReducedMotion() ? 0 : EXPAND_MS, easing: EXPAND_EASE },
    );
    motion.current = animation;
    animation.finished.then(
      () => {
        if (motion.current === animation) motion.current = null;
      },
      () => {},
    );
  }, [open, measure]);

  // Keep measuring while open, and stop while shut — so a closed card's panel
  // is never a box with a stale height, and the *next* open reads a header that
  // has laid out at the current width rather than one from whenever it was
  // last open.
  useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) {
      setFit(null);
      return;
    }

    const summary = panel.parentElement?.querySelector(":scope > summary");
    // **The list as well as the header, and the list is the one that is easy to
    // forget.** A press opens the panel against a page that is still scrolling;
    // ~340ms later the list becomes the parked shell and its height changes from
    // the whole document's to the viewport's, which is exactly the box `measure`
    // reads its room out of. Nothing else fires then — the summary has not moved
    // and neither has the window — so without this the panel would keep the cap
    // it *predicted* before the park. The two agree by construction, which is
    // why this is a guard rather than a fix; it is here so that they cannot stop
    // agreeing silently.
    const list = panel.closest("ul");
    const observer = new ResizeObserver(() => {
      // Re-measure only. A header that re-wraps is not a reason to move the
      // page — the reader is looking at something.
      measure();
    });
    if (summary) observer.observe(summary);
    if (list) observer.observe(list);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  /**
   * Run the collapse, over the box the panel is standing at.
   *
   * A **layout effect**, so it starts in the same frame the close does rather
   * than a paint later — and cancelled on cleanup, so a card re-opened inside
   * the collapse is not left with an animation still holding it shut. The clip
   * keeps the housing's own radius at the edge that moves, read off the
   * element rather than spelled again here, because the two expanded halves
   * are cut at two different radii.
   */
  useIsomorphicLayoutEffect(() => {
    if (!closing) return;
    const panel = ref.current;
    if (!panel) return;
    motion.current?.cancel();
    const radius = getComputedStyle(panel).borderRadius || "0px";
    const animation = panel.animate(
      [
        {
          clipPath: `inset(0 0 0 0 round ${radius})`,
          opacity: 1,
          transform: "translateY(0px)",
        },
        {
          clipPath: `inset(0 0 100% 0 round ${radius})`,
          opacity: 0,
          transform: "translateY(-10px)",
        },
      ],
      {
        duration: prefersReducedMotion() ? 0 : COLLAPSE_MS,
        easing: COLLAPSE_EASE,
        fill: "forwards",
      },
    );
    motion.current = animation;
    return () => {
      animation.cancel();
      if (motion.current === animation) motion.current = null;
    };
  }, [closing]);

  const phase: Phase = !open ? "shut" : closing ? "collapse" : "open";

  return { ref, style: styleFor(phase, fit), mounted: open };
}

function styleFor(phase: Phase, fit: PanelFit | null): CSSProperties | undefined {
  if (phase === "shut" || fit === null) return undefined;
  // **Open and collapsing are one style.** The collapse moves no box — see the
  // note on `Phase` — so the cap, the floor and the flex all stand for as long
  // as the animation runs over them, and the disclosure closing is what takes
  // the panel out of the flow at the end.
  return {
    // The panel takes what the card's column has left, clamped. `flex-basis:
    // auto` and not `0%`: a basis of zero makes the box's hypothetical size
    // nothing, and a card whose panel has not measured yet would open at a
    // height flex invented rather than at its content's.
    flex: "1 1 auto",
    maxHeight: fit.cap,
    // Only where the room is under the floor — see `panelFit`.
    minHeight: fit.minHeight || undefined,
  };
}
