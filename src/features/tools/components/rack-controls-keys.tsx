"use client";

import type { ReactNode } from "react";

import {
  CONSOLE_CHANNEL_METAL,
  CONSOLE_KEY_PILL_SHELL,
  type RackControls,
} from "@/features/shared";

/**
 * The page's own controls, in the rack: the Browse track.
 *
 * **Nothing reaches it today, and that is recorded rather than deleted.** The
 * manager page's Browse pair came down into a dock pinned to the foot of the
 * viewport, and the two week tools have since followed with their own key — so
 * `useRackControls` answers null on every route and this never renders. What
 * kept it is `peekActiveSeason`'s rule: the argument below is the one a reader
 * would otherwise have to reconstruct if a page ever publishes again, and the
 * seam it is half of is still live in one respect — `RackDrawerKey` is the
 * shape all three pages type their keys as, which is precisely what let them
 * move without a `switch` on the route. See `browse-dock.tsx`, which is where
 * these caps are drawn now and is the rack's vocabulary taken with them.
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
 * **What it draws comes from the page, not from this folder — the legends and
 * the glyphs included.** The rack is mounted above `{children}` and cannot see
 * a page's state, so `RackControls` is published upward and this component only
 * mounts it; a page that publishes nothing renders none of this, the rule the
 * tools menu already lives by. The two legends used to be written here, which
 * held while `/manager` was the only page publishing a pair; the week tools
 * published a key of their own, and a rack naming both pages' vocabularies
 * would need a `switch` on the route to choose between them. So the keys are
 * data and this maps over them — and when the phone cap became a picture rather
 * than a word, the picture joined them for exactly the same reason.
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
 * **The pair sits on the rack at every width, and the fold is gone.** Below
 * `md` it was one sliders key opening a popover of the same two keys, and what
 * that cost was a press: the keys the pinning exists to keep in thumb reach
 * were two presses away on the only device where reaching back up the page is
 * hard. What paid for unfolding it is the readout moving to the left of the
 * row, out of the right-hand cluster — see `app-rack.tsx`, where that trade is
 * measured — plus the legends becoming glyphs: the pair is a 77px channel as
 * two 32px caps against the 249.8–259.5 the same two keys measure with their
 * legends on.
 *
 * The keys that carry a legend at `md` therefore carry a **picture** below it,
 * and the legend stays as the button's `sr-only` name rather than becoming an
 * `aria-label`: one spelling of the word, on the same element, at both widths.
 *
 * **One track serves both layouts and nothing is rendered twice.** It is a
 * flex item of the rack's own row below `md` and joins it under `md:order-4`
 * above — no `md:contents` wrapper is needed any more, because with the fold
 * gone there is no panel around it to stop generating a box. The switch between
 * the two shapes is the cascade on one element, never state: a client component
 * in the rack above every page must not have to hydrate to learn a breakpoint.
 *
 * **What went with the fold** is `useState`, `useRef`, `useEffect`, `dismiss`,
 * the capture-phase `pointerdown` and the Escape handler — this holds no state
 * at all now. One rule those carried is worth keeping written down, because it
 * comes straight back with any dialog mounted in this subtree: a modal
 * `<dialog>` is in the top layer only for as long as it still generates a box,
 * so hiding the panel it lives in takes the modal off screen with it and leaves
 * a backdrop over an inert page — a key that reads as dead. Every key here
 * opens one of the page's *own* drawers, mounted nowhere near this box, which
 * is what made dismissing on the press safe while there was a menu to dismiss.
 */
export function RackControlsKeys({ controls }: { controls: RackControls }) {
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
    // **A cut floor below `md` and `--track-shadow-deep` over key stock
    // above**, which is not two finishes for one object so much as one recess
    // seen through two amounts of it. A 32px circle in 4px of channel leaves
    // the floor visible all the way round and between the two; a legend pill in
    // 5px of it very nearly fills the track, and the sliver left reads as the
    // lit lip of a face rather than as a floor at all. So the phone arm goes
    // deeper and the `md` arm is untouched — the desktop path is not what this
    // pass is about.
    //
    // The floor is `--rack-channel-*` rather than `CONSOLE_CHANNEL`, which is
    // this same recess and the shape it was drawn from: that constant's floor
    // is a black alpha, which is a channel on the dark stock its other caller
    // sits on and a hole punched through a near-white rack. See the token.
    //
    // `md:bg-transparent` is what takes the channel's *colour* back off at
    // `md`; a background colour and a background image are two properties, so
    // without it the key stock would be an opaque gradient painted over a tint
    // nobody can see and nobody meant.
    <div
      role="group"
      aria-label="Browse"
      className={`${CONSOLE_CHANNEL_METAL} flex shrink-0 items-center gap-[0.3125rem] p-1 md:order-4 md:gap-[0.4375rem] md:bg-[image:var(--key-bg)] md:bg-transparent md:p-[0.3125rem] md:shadow-[var(--track-shadow-deep)]`}
    >
      {keys.map(({ kind, label, icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onOpenDrawer(kind)}
          aria-haspopup="dialog"
          aria-expanded={drawer === kind}
          // Shape and finish composed rather than concatenated onto a string
          // that already names a border colour — same specificity, and which
          // one wins is decided by Tailwind's emit order. The legend's emboss
          // is a token for the same reason the face is: the dark cap lights its
          // ink from above and the light one from below, and neither is the
          // other at a different alpha.
          //
          // **The geometry comes off the shell, never off `CONSOLE_KEY_PILL`.**
          // A 32px cap cannot be got by appending `size-8` to a string already
          // saying `px-4 py-2` — the padding would still be there and the cap
          // would be a 64px lozenge. So the shell carries no padding, the phone
          // arm is a square, and `md:size-auto` hands the width back to the
          // pill's own gutter at `md`.
          className={`${CONSOLE_KEY_PILL_SHELL} inline-flex size-8 items-center justify-center [text-shadow:var(--cap-ink-emboss)] md:size-auto md:px-4 md:py-2 ${cap(
            drawer === kind,
          )}`}
        >
          <CapGlyph>{icon}</CapGlyph>
          {/*
            The legend, and the cap's accessible name at both widths. `sr-only`
            below `md` rather than an `aria-label` on the button, so the word
            has one spelling on one element — a label attribute beside a visible
            span at `md` is two places for it to drift.
          */}
          <span className="sr-only md:not-sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A glyph cut into the cap rather than drawn on it.
 *
 * The emboss is a `filter` on a wrapper rather than a `text-shadow`, because it
 * has to follow the stroke's own alpha — a shadow on the box would be a
 * rectangle's highlight under a picture of two players. `z-[1]` keeps it over
 * the cap's inset highlight.
 *
 * `md:hidden`, because at `md` the cap's face is its legend: a picture beside
 * the word is the same fact twice on a key 32px tall.
 */
function CapGlyph({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="relative z-[1] inline-flex [filter:var(--cap-glyph-emboss)] md:hidden"
    >
      {children}
    </span>
  );
}
