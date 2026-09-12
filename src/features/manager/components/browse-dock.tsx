"use client";

import { useEffect, useRef, useState } from "react";

import { CONSOLE_KEY_PILL_BARE, type RackDrawerKey } from "@/features/shared";

import {
  DOCK_AT_REST,
  DOCK_SETTLE_MS,
  dockRested,
  dockScroll,
  type DockScroll,
} from "../helpers/dock-scroll";

/**
 * The page's two Browse keys, as hardware floating over it.
 *
 * They were in the app rack, published up there by this page through the
 * rack-controls context, and what moves them is the argument the rack itself
 * already makes about this pair: they are the only thing in the rack that acts
 * on the page *underneath* it, where the brand link and the tool tray navigate
 * and the tool-name readout only reports. Pinned to the bottom-right of the
 * viewport they are where a thumb is rather than where the page's chrome is —
 * which is what the rack's own pinning was for, one corner over — and the rack
 * goes back to being the app's furniture alone.
 *
 * **The vocabulary is the rack's: a housing, a channel cut into it, and two
 * filled accent caps travelling in that channel.** The one thing that differs
 * is the housing's material, and it is the whole of what makes this read as a
 * separate object rather than as a billet that has come loose: it is
 * *translucent*, over a short blur, so the card behind it stays legible and the
 * dock reads as lit hardware above the page rather than as more of the same
 * stock. The fill alphas are low and the blur is short for exactly that reason
 * — see `--dock-bg`, where the pass that was an opaque panel is recorded.
 *
 * **Where it lives is this folder rather than `features/shared/ui`**, which is
 * the handoff's own suggestion and the one thing in it not taken. The rule that
 * decides it is the one every other piece in `shared/` moved on — a second
 * feature reads it — and today one does not: the two week tools still publish
 * their pair into the rack. Nothing here is manager-specific (the keys arrive
 * as data, exactly as the rack takes them), so the day one of them wants a dock
 * this is a move rather than a rewrite; until then it would be a module in the
 * barrel every page imports, for one page's chrome.
 */
export function BrowseDock({
  keys,
  drawer,
  onOpen,
  parked,
  chromeClass,
}: {
  /** The same array the rack took — see the page's `BROWSE_KEYS`. */
  keys: readonly RackDrawerKey[];
  /** Which drawer is open, so the cap that opened it can say so. */
  drawer: string | null;
  onOpen: (kind: RackDrawerKey["kind"]) => void;
  /** Whether a card has the screen. See {@link useDocked} and the note below. */
  parked: boolean;
  /**
   * `ActiveCard.chromeClass`. **The dock stands down with the page's own chrome
   * while a card is parked**, and that is a decision rather than a default.
   *
   * Two things push against keeping it: a parked card is sized to the fold less
   * a little breath, so a part floating at the bottom-right of the viewport
   * covers the bottom-right of the card — which on this page is the roster
   * pane's own drawer bars, one control over another. And it is the answer the
   * gametime stat board's bar already gives from the same position: the page's
   * chrome steps back for a card that has the screen.
   *
   * What it costs is a press. In the rack these keys were reachable while a
   * card was parked, and `openDrawer`'s own note argues that press is
   * meaningful there — it closes the card and takes the reader back to the grid
   * they are about to narrow. That press is now Escape and then the key, which
   * is the cheaper of the two losses: a control hidden *under* another control
   * is a press that misfires rather than one more press.
   */
  chromeClass: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const docked = useDocked(ref, parked);

  return (
    // **The housing.** Stacked below `sm` and a row above it, which is a width
    // rather than a preference: two legended pills side by side run ~300px of a
    // 390px screen, which is a bottom bar pretending to be a floating dock.
    // Stacked they are `items-stretch`, so both caps take the wider one's width
    // and their glyphs line up in a column.
    //
    // `inert` while hidden rather than `pointer-events-none` alone, which is
    // `CollapseTray`'s finding: the mouse is stopped by the one and a keyboard
    // reader is not, so without it Tab lands on a control translated off the
    // bottom of a viewport it cannot scroll into view.
    //
    // **The hidden transform is spelled as an arbitrary `transform`, and both
    // halves of that are things a render had to say.**
    //
    // Tailwind's own `translate-y-*` sets the `translate` *property* rather
    // than `transform`, so a `transition-property: transform` beside it names
    // a property that never moves — the dock would jump rather than travel,
    // with nothing in the computed style looking wrong. And an arbitrary value
    // is whitespace-stripped, so `calc(100%+1.25rem)` reaches the browser
    // exactly as written and is **invalid CSS**: the declaration is dropped and
    // the dock only fades, which is what the first drive of this found. The
    // underscores are what put the spaces back.
    //
    // It carries the bottom offset as well as the height, or the dock parks
    // with its own margin still on screen — and the offset is two values, so
    // the transform is two.
    <div
      ref={ref}
      role="group"
      aria-label="Browse"
      inert={!docked}
      className={`lab-anim fixed bottom-5 right-2 z-50 flex flex-col items-stretch rounded-[1.625rem] border border-[var(--dock-rim)] bg-[image:var(--dock-bg)] p-[0.3125rem] shadow-[var(--dock-shadow)] backdrop-blur-[5px] backdrop-saturate-[1.4] [transition:transform_220ms_cubic-bezier(0.32,0.72,0,1),opacity_160ms_linear] sm:bottom-6 sm:right-6 sm:flex-row sm:items-center sm:rounded-full ${
        docked
          ? "[transform:translateY(0)] opacity-100"
          : "[transform:translateY(calc(100%_+_1.25rem))] opacity-0 sm:[transform:translateY(calc(100%_+_1.5rem))]"
      } ${chromeClass}`}
    >
      {/*
        **The channel**, and it is a lightened `--rack-channel-*` rather than
        that pair: those values are cut for stock, and a 52% floor under a deep
        inset stacks with a translucent housing and kills the blur the housing
        is for. See `--dock-channel-bg`.
      */}
      <div className="flex flex-col items-stretch gap-[0.3125rem] rounded-[1.375rem] bg-[var(--dock-channel-bg)] p-1 shadow-[var(--dock-channel-shadow)] sm:flex-row sm:items-center sm:gap-[0.4375rem] sm:rounded-full">
        {keys.map(({ kind, label, icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onOpen(kind)}
            aria-haspopup="dialog"
            aria-expanded={drawer === kind}
            // **`CONSOLE_KEY_PILL_BARE`, never the shell**, and that is the
            // emit-order trap rather than a preference: the shell declares
            // `text-[length:…]` and `tracking-[0.16em]`, both arbitrary values,
            // so a cap appending its own tracking would be a coin flip decided
            // by the order Tailwind happened to emit the two. The bare shape
            // names no size and no padding, which is exactly what it is for.
            //
            // `h-11` is the app's touch-target floor and is spelled at every
            // width, legends and all — these are the page's two exits, not a
            // shortcut learned by position.
            //
            // The glyph and the legend both ship. The rack's cap draws one or
            // the other, because there its face is 32px and a picture beside
            // the word is the same fact twice; here the caps are 44px and the
            // two person marks — one figure against two — are close enough at
            // 17px that the word is what tells them apart.
            className={`${CONSOLE_KEY_PILL_BARE} inline-flex h-11 items-center justify-start gap-2 border-[var(--cap-accent-border)] bg-[image:var(--cap-accent-bg)] px-3.5 text-[length:var(--fs-11)] tracking-[0.14em] text-[var(--cap-accent-ink)] shadow-[var(--cap-accent-shadow),var(--dock-cap-glow)] [text-shadow:var(--cap-ink-emboss)] sm:justify-center sm:tracking-[0.16em]`}
          >
            {/*
              The glyph is cut into the cap rather than drawn on it, so its
              emboss is a `filter` on a wrapper rather than a `text-shadow`: it
              has to follow the stroke's own alpha, where a shadow on the box
              would be a rectangle's highlight under a picture of two players.
              `z-[1]` keeps it over the cap's inset highlight.
            */}
            <span
              aria-hidden
              className="relative z-[1] inline-flex shrink-0 [filter:var(--cap-glyph-emboss)]"
            >
              {icon}
            </span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Whether the dock stands, read off the window's scroll.
 *
 * The rule itself is `dockScroll`, pure and under Node's own runner; what is
 * here is the wiring, and three things about it are load-bearing.
 *
 * **Nothing is attached while a card is parked.** `useActiveCard` locks
 * `documentElement` there, so the page fires no scroll at all — which means a
 * dock that had gone away on the way down would have no way back until the card
 * closed. It stands up on both edges of a park instead, which costs nothing
 * going in (the page's own chrome rule has it `display: none` by then) and is
 * the whole of it coming out.
 *
 * **The baseline is nulled on both edges of that.** The park scrolls the window
 * to the top and the close walks it back to wherever leaves the card on the
 * line it is standing on, and both land as ordinary `scroll` events — the
 * second a large positive delta that would hide the dock every time a reader
 * closed a card. `DOCK_AT_REST` carries no baseline, so whichever of the two
 * effects runs first, the jump is spent on the baseline rather than read as a
 * direction. See {@link DockScroll.from}.
 *
 * **The settle is a timer here rather than a rule there**, because the rule has
 * no clock: `dockRested` says what standing up at rest *is* and this is what
 * notices that the page has stopped. It is cleared and rearmed on each scroll
 * while the dock is away, so what fires it is silence rather than an elapsed
 * total, and it is cleared on teardown — a park unsubscribes, and a timer that
 * outlived one would stand the dock up behind a card that has the screen.
 *
 * **A dock with focus inside it does not leave.** Arrow keys scroll the page
 * while a button is focused, so without this a keyboard reader on a cap would
 * watch it go `inert` under them and be dropped to `<body>`.
 *
 * And under `prefers-reduced-motion` it simply never hides. `.lab-anim` clears
 * the transition but not the transform, so a dock that still hid would jump off
 * screen rather than travel — the README's own second option, and the one that
 * leaves a control where the reader left it. It is asked per qualifying scroll
 * rather than once, so a preference changed mid-session is honoured on the next
 * one.
 */
function useDocked(
  ref: { current: HTMLElement | null },
  parked: boolean,
): boolean {
  const [docked, setDocked] = useState(true);
  const state = useRef<DockScroll>(DOCK_AT_REST);

  // Standing it up on either edge of a park, **during render**: a card closing
  // is a deliberate return to the grid these two keys narrow, and a dock that
  // came back from one still hidden would be an exit the reader has to scroll
  // for. Adjusting state for a changed input during render is the pattern React
  // documents and the one `useManagerLineups` already resets its subject by;
  // doing it in the effect below is the cascading render
  // `react-hooks/set-state-in-effect` exists to stop.
  const [renderedParked, setRenderedParked] = useState(parked);
  if (renderedParked !== parked) {
    setRenderedParked(parked);
    setDocked(true);
  }

  useEffect(() => {
    state.current = DOCK_AT_REST;
    if (parked) return;

    let settle: ReturnType<typeof setTimeout> | undefined;

    const rest = () => {
      settle = undefined;
      const next = dockRested(state.current);
      if (next === state.current) return;
      state.current = next;
      setDocked(true);
    };

    const onScroll = () => {
      const next = dockScroll(state.current, window.scrollY);
      if (next !== state.current) {
        state.current = next;

        const stay =
          ref.current?.contains(document.activeElement) === true ||
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
            true;
        setDocked(stay ? true : next.docked);
      }

      // Armed **only while the dock is away**, and after the decision above
      // rather than before it, so the event that hides it is the event that
      // starts the clock. Rearming on every scroll of a dock that is standing
      // would be a timer per frame that exists to do nothing, and a reader
      // scrolling *up* is the ordinary way this page is read.
      if (state.current.docked) return;
      clearTimeout(settle);
      settle = setTimeout(rest, DOCK_SETTLE_MS);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(settle);
    };
  }, [parked, ref]);

  return docked;
}
