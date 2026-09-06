"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  CONSOLE_KEY_PILL,
  CONSOLE_KEY_PILL_SHELL,
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
 * **These are the rack's one filled object, and that is an argument rather
 * than a finish.** Everything else up there is machined — a key pressed into a
 * housing, a readout engraved on one — and these two are the only things in
 * the rack that act on the page *underneath* it: the brand link and the tool
 * tray navigate, and the tool-name readout only reports. So they are a domed
 * accent cap with the glyph cut into it, travelling in a channel cut deeper
 * than `--track-shadow` (a filled cap in the shallow one reads as sitting on
 * the rack rather than in it). The tool key beside them deliberately stays
 * machined: two filled objects in one pill would put the emphasis nowhere.
 *
 * The cap's colours are tokens rather than literals for `globals.css`'s own
 * reason, and here it is load-bearing rather than tidy — **the light cap is not
 * the dark one dimmed, it inverts**. Light mode's accent is a dark teal, so the
 * dark scheme's arrangement (pale cap, dark ink) fails contrast outright and
 * light is a teal cap with white ink instead. That cannot be written as an
 * alpha, and an `rgba()` in a class string cannot invert at all. The same goes
 * for the two embosses: `--cap-ink-emboss` lights a legend from above in dark
 * and from below in light, and `--cap-glyph-emboss` is the same highlight as a
 * `drop-shadow` filter, because a glyph's emboss has to follow the stroke's
 * alpha rather than the box around it.
 *
 * **Below `md` the keys collapse behind one icon-only key.** That is answered
 * the way this folder already answered it once: `ToolsMenu` replaced a six-key
 * track with one key and a menu, because the track did not fit and its far end
 * was reachable only by a horizontal swipe nobody would guess at. The two
 * alternatives were a second stacked row, which is what the rack was rewritten
 * to remove and which costs ~112px of an 844px screen *permanently* once the
 * rack is pinned, and leaving the controls on the page at narrow widths, which
 * would mount both drawers' triggers twice.
 *
 * **The fold is `md`, and it was `lg` because of a measurement that no longer
 * held.** That figure was taken when there were two tracks here: the rack's row
 * was ~900px of content, so at 768 it wrapped to a second line — 114px of
 * pinned rack with the page's first row *underneath* it. This note used to say
 * `md` may well hold one track now and that the breakpoint would stay put until
 * a render said otherwise; the render says otherwise. At 768 on `/manager`:
 * brand link 208 + 33 (gap, groove, gap) + readout 68 + 16 + the pair with
 * their legends 257 + 16 + tool key 40 = **638 against 718**.
 * `/lineupchecker`'s pair is 8px narrower and fits with the same margin.
 *
 * Below `md` the pair stays folded, and that is the same kind of measurement
 * rather than caution: as text it needs 589px against the 342 a phone's pill
 * gives, and a rack that wrapped would break the one assumption `--rack-clear`
 * encodes — that the rack is exactly one row at every width, which is why that
 * token is three values and not five.
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
 * panel is `display: contents` at `md`, so its box stops existing and the track
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

  // The cap. Border, face and ink are one set of tokens, and the shadow is
  // composed **whole** in one utility rather than as a lit `shadow-[…]` beside
  // the resting one: two shadow utilities of the same specificity are the emit
  // order coin flip again, and a cap that lost its dome would be the visible
  // half of it.
  //
  // Lit is a halo rather than a rim, which is a consequence of the finish: the
  // key is already accent, so `border-active/45` — what the machined keys light
  // with — has nothing to say against a border that is part of the cap.
  const cap = (lit: boolean) =>
    "border-[var(--cap-accent-border)] bg-[image:var(--cap-accent-bg)] " +
    "text-[var(--cap-accent-ink)] " +
    (lit
      ? "shadow-[var(--cap-accent-shadow),0_0_0_2px_var(--accent-glow)]"
      : "shadow-[var(--cap-accent-shadow)]");

  return (
    // Below `md` this is the folded key and the panel it opens; at `md` the box
    // stops existing and the track inside carries its own order into the rack's
    // own flex row.
    <div ref={root} className="relative shrink-0 md:contents">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="rack-controls-panel"
        onClick={() => setOpen((value) => !value)}
        // The folded key stands for the pair, so it wears the pair's finish.
        //
        // **The padding comes off the shell rather than over the pill**, and
        // that is the thing to keep: `px-2.5` appended to a string already
        // saying `px-4` is not a narrower key, it is the same key — Tailwind
        // emits the scale ascending, so the larger value wins whatever the
        // class attribute says. See `CONSOLE_KEY_PILL_SHELL`.
        className={`${CONSOLE_KEY_PILL_SHELL} inline-flex items-center px-2.5 py-2 md:hidden ${cap(
          drawer !== null,
        )}`}
      >
        <CapGlyph>
          <SlidersMark />
        </CapGlyph>
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
        } md:contents`}
      >
        {/* The deep channel, spelled out rather than composed from
            `CONSOLE_TRACK`: that constant names `--track-shadow`, and a second
            `shadow-[…]` beside it would be the same coin flip the cap's own
            shadow is written whole to avoid. */}
        <div className="flex items-center gap-[0.4375rem] rounded-full bg-[image:var(--key-bg)] p-[0.3125rem] shadow-[var(--track-shadow-deep)] md:order-4 md:shrink-0">
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
              // Shape and finish composed rather than concatenated onto a
              // string that already names a border colour — same specificity,
              // and which one wins is decided by Tailwind's emit order. The
              // legend's emboss is a token for the same reason the face is:
              // the dark cap lights its ink from above and the light one from
              // below, and neither is the other at a different alpha.
              className={`${CONSOLE_KEY_PILL} inline-flex items-center [text-shadow:var(--cap-ink-emboss)] ${cap(
                drawer === kind,
              )}`}
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
 * A glyph cut into the cap rather than drawn on it.
 *
 * The emboss is a `filter` on a wrapper rather than a `text-shadow`, because it
 * has to follow the stroke's own alpha — a shadow on the box would be a
 * rectangle's highlight under a picture of three sliders. `z-[1]` keeps it over
 * the cap's inset highlight.
 */
function CapGlyph({ children }: { children: ReactNode }) {
  return (
    <span className="relative z-[1] inline-flex [filter:var(--cap-glyph-emboss)]">
      {children}
    </span>
  );
}

/**
 * The controls glyph: three channels with a key travelling in each, which is
 * the console's own picture of what is behind this button.
 *
 * 17px rather than the 16 a machined key draws, and a heavier stroke with it:
 * cut into a lit cap it is reading against a face rather than against the
 * rack's own ground, and at 1.7 on 16 the channels closed up.
 */
function SlidersMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[1.0625rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
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
