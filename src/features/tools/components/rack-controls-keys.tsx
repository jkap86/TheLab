"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CONSOLE_KEY_PILL,
  CONSOLE_TRACK,
  type RackControls,
} from "@/features/shared";

/**
 * The page's own controls, in the rack: the Browse track.
 *
 * It was two tracks and four keys — Players and Leaguemates, then Filters and
 * Columns — which is what the manager page's two header housings became when
 * the rack was pinned. **The View track has since gone back down onto the
 * page**, and the argument for it up here is what failed: a Filters key in the
 * rack said "a filter is on" while the identity plate's `Leagues 9 / 14` said
 * the same thing with a number, and neither named what had been narrowed. On
 * the plate the key, the count and the summary sentence are one object, and the
 * columns are a tray of chips under it. What is left here is the pair that does
 * *not* describe the page — the two keys open drawers — and for those the
 * scroll-depth argument still holds: the header scrolls away after two cards.
 *
 * **What it draws comes from the page, not from this folder — the legends
 * included.** The rack is mounted above `{children}` and cannot see a page's
 * state, so `RackControls` is published upward and this component only mounts
 * it; a page that publishes nothing renders none of this, the rule the tools
 * menu already lives by. The two legends used to be written here, which held
 * while `/manager` was the only page publishing a pair; the lineup checker
 * publishes `Starters` and `Opponents`, and a rack naming both pages' keys
 * would need a `switch` on the route to choose between them. So the keys are
 * data and this maps over them — same track, same fold, same dismissal.
 *
 * **Below `lg` the keys collapse behind one icon-only key.** That is answered
 * the way this folder already answered it once: `ToolsMenu` replaced a six-key
 * track with one key and a menu, because the track did not fit and its far end
 * was reachable only by a horizontal swipe nobody would guess at. The key is
 * icon-only for the theme key's reason, that the legend is the first thing to
 * go. The two alternatives were a second stacked row, which is what the rack
 * was rewritten to remove and which costs ~112px of an 844px screen
 * *permanently* once the rack is pinned, and leaving the controls on the page
 * at narrow widths, which would mount both drawers' triggers twice.
 *
 * **The breakpoint is `lg`, not the `md` the rest of the rack turns on.** It
 * was measured when there were two tracks here: the rack's row was ~900px of
 * content, so at `md` (768px) it wrapped to a second line — 114px of pinned
 * rack with the page's first row *underneath* it. One track is ~220px less, so
 * `md` may well hold it now; the breakpoint stays where the measurement put it
 * until a render says otherwise, since what is on the other side of a wrong
 * guess is `--rack-clear` computed against a rack that is quietly two rows
 * tall. Everything else about the rack still switches at `md`.
 *
 * The menu is not a `<dialog>`, for `ToolsMenu`'s reason: those are modal, and
 * a popover holding a couple of keys should not trap focus and dim the page. So
 * the dismissal a dialog gives for free is spelled out — a capture-phase
 * `pointerdown`, so a press that starts outside dismisses before whatever it
 * landed on acts on it, and Escape, which returns focus to the key it came
 * from.
 *
 * **The `close` listener that used to sit here is gone with the View track**,
 * and the rule it enforced is worth keeping written down because it would come
 * straight back with any dialog mounted in this subtree: a modal `<dialog>` is
 * in the top layer only for as long as it still generates a box, so hiding the
 * panel it lives in takes the modal off screen with it and leaves a backdrop
 * over an inert page — a key that reads as dead. Every key here opens one of
 * the page's *own* drawers, which are mounted nowhere near this box, so they
 * can and do dismiss the menu on the press.
 *
 * **The same track serves both layouts, and no markup is rendered twice.** The
 * panel is `display: contents` at `lg`, so its box stops existing and the track
 * joins the rack's flex row directly under its own `order` — the trick the
 * brand row above already turns, and the reason the drawer a key opens on a
 * phone is the same mounted drawer it opens on a desktop.
 */
export function RackControlsKeys({ controls }: { controls: RackControls }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Dismiss the menu, and put focus back on the key it came out of — the panel
  // is about to stop generating a box, and a browser dumps focus to `<body>`
  // when the element holding it is hidden out from under it.
  const dismiss = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const node = root.current;
    const onDown = (event: PointerEvent) => {
      if (!node?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, dismiss]);

  const { keys, drawer, onOpenDrawer } = controls;
  // Lit while a drawer is open, which is now the whole of what this key has to
  // report: the filter state is on the page's own plate, beside the figure it
  // moves and the sentence saying what it narrowed. A closed menu saying "a
  // filter is on" and nothing else was the weaker half of that pair anyway.
  const filtering = drawer !== null;

  const key = `${CONSOLE_KEY_PILL} inline-flex items-center bg-[image:var(--key-bg)] shadow-[var(--key-shadow)]`;
  const state = (on: boolean) =>
    on
      ? "border-active/45 text-readout"
      : "border-foreground/10 text-foreground/80 hover:text-readout";

  return (
    // `md:order-4` places the key between the tools menu and the theme pad for
    // the band where the rack is one row but the track is still folded away;
    // at `lg` the box stops existing and the track carries its own order.
    <div ref={root} className="relative shrink-0 md:order-4 lg:contents">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="rack-controls-panel"
        onClick={() => setOpen((value) => !value)}
        className={`${CONSOLE_KEY_PILL} inline-flex items-center bg-[image:var(--key-bg)] px-2.5 shadow-[var(--key-shadow)] lg:hidden ${state(
          filtering,
        )}`}
      >
        <SlidersMark />
        <span className="sr-only">Browse controls</span>
      </button>

      <div
        id="rack-controls-panel"
        role="group"
        aria-label="Browse"
        className={`${
          open
            ? "absolute right-0 top-full z-50 mt-2.5 flex min-w-[14.5rem] flex-col items-stretch gap-2 rounded-[0.875rem] border border-foreground/8 bg-[image:var(--key-bg)] p-1.5 shadow-[var(--well-shadow),0_24px_44px_-20px_#000]"
            : "hidden"
        } lg:contents`}
      >
        <div
          className={`${CONSOLE_TRACK} flex items-center gap-1.5 p-1 lg:order-4 lg:shrink-0`}
        >
          {/* Every key dismisses the menu on the press, and that is safe for
              exactly one reason: a shares drawer is the *page's* dialog, mounted
              nowhere near this box, so hiding the menu behind it leaves a clean
              page. A dialog mounted in here could not do this — see the module
              note. */}
          {keys.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                onOpenDrawer(kind);
                setOpen(false);
              }}
              aria-haspopup="dialog"
              aria-expanded={drawer === kind}
              // Shape and state composed rather than concatenated onto a string
              // that already names a border colour — same specificity, and which
              // one wins is decided by Tailwind's emit order.
              className={`${key} ${state(drawer === kind)}`}
            >
              {label}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}

/**
 * The controls glyph: three channels with a key travelling in each, which is
 * the console's own picture of what is behind this button.
 */
function SlidersMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="17" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
