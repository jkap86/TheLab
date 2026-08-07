import type { ReactNode } from "react";

/**
 * A card's name, on a plate straddling its top edge.
 *
 * **It is in `features/shared` because a second list wears it**, which is the
 * mover's rule rather than a filing preference: the trades board wrote it, the
 * leagues list draws the same part, and the two have to agree to the pixel or one
 * list reads as a slightly different product from the other. What is shared is
 * the plate's box, its rail and the heading's type — everything a reader judges
 * the part by. What is *not* shared is what the heading contains: a trade card's
 * plate opens a league, a league card's toggles a panel, and those are different
 * controls with different semantics (see each caller).
 *
 * Three things about it are load-bearing, and each is a way of getting it wrong:
 *
 * - **It must be a sibling of the card's face, never a child.** `clip-path` clips
 *   its whole subtree, so a plate rendered inside a notched face would be severed
 *   at the exact edge it exists to straddle. The caller is `relative`, and the
 *   overhang is that caller's *padding* rather than a negative margin — a part
 *   hanging outside the card's box drifts every measurement taken of it (which is
 *   what a windowed list does to every card in it).
 * - **It is a plate, not a chip.** Rectangular, no press travel, no bloom.
 *   "Raised means press me" belongs to the keys and pills; a plate with a lit top
 *   edge reads as a label stamped on a part, which is what makes it safe to hang
 *   a heading on whether or not that heading is also a button.
 * - **The heading is `h2`.** Both callers sit under one `h1` — the manager plate
 *   on one page, a visually-hidden title on the other — so a card is the next
 *   level down and a 3 here would skip one.
 */
export function Nameplate({
  children,
  trailing,
}: {
  /**
   * What the plate names — the heading's own contents, so a caller that needs a
   * control passes a `<button>` and one that doesn't passes text. A `<button>`
   * takes phrasing content and a heading is flow, which is why the button goes
   * inside the `h2` rather than around it.
   */
  children: ReactNode;
  /**
   * Anything riding after the name — a status lamp. Outside the heading, so it
   * is not part of what the name announces, and outside the truncating span, so
   * a long name shortens rather than pushing it off the plate.
   */
  trailing?: ReactNode;
}) {
  return (
    <div className="lab-nameplate absolute left-3.5 top-0 z-10 flex max-w-[calc(100%-3rem)] items-center gap-2 rounded-[5px] py-1 pl-2 pr-3">
      <span
        aria-hidden="true"
        className="lab-billet-rail h-4 w-0.5 shrink-0 rounded-sm"
      />
      {/* 12px rather than the 13px a card's face wears — one step down for the
          plate, not two. At 11px, tracked out and dimmed, the name was the
          hardest thing on the card to read: the plate is small, so the letters
          were doing the work the surface should, and a display face at that size
          loses more to tracking than it gains. `leading-4` is spelled rather than
          inherited because `truncate` clips what overflows, and a line box that
          depends on an ancestor is a clipped ascender waiting for someone to set
          one. */}
      <h2 className="min-w-0 truncate font-display text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground [text-shadow:0_1px_0_rgba(255,255,255,0.14),0_-1px_1px_rgba(0,0,0,0.9)]">
        {children}
      </h2>
      {trailing}
    </div>
  );
}

/**
 * The class a control on the plate wears, so the two callers' buttons cannot
 * drift apart in shape while their behaviour differs.
 */
export const NAMEPLATE_BUTTON =
  "max-w-full cursor-pointer truncate rounded-[3px] outline-offset-2 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-active";
