"use client";

import type { ReactNode } from "react";

import type { AdpBayId } from "./adp-drawer.utils.ts";

/**
 * Where the tongue sits under each key, as a fraction of the bay's own width.
 *
 * The keys are three equal `flex-1` shares (see {@link AdpBayRail}), so their
 * centres are at a sixth, a half and five sixths of the rail — and the bay is
 * laid on **exactly the rail's box** (`inset-x-4`, the pinned block's own `px-4`)
 * so those fractions land on this one too. That is what lets the tongue be placed
 * in CSS with nothing measured: a JS position would have to be recomputed on
 * every resize of a panel that is already `@container`-queried, to place a 9px
 * nub.
 *
 * **`inset-x-0` is the spelling that looks right and is wrong**, and it is worth
 * knowing why, because nothing about it reads as a bug: an absolutely positioned
 * element resolves against its ancestor's *padding* box, so `inset-x-0` makes the
 * bay 32px wider than the rail and shifts it 16px left — which leaves the outer
 * two tongues **10.7px** off their keys, wider than the nub itself, while the
 * middle one stays perfect. Measured on the real stylesheet, not reasoned about.
 *
 * What is left is approximate by the rail's own `p-1` and its two `gap-1.5`,
 * which comes to **0.7px** at the ends — well inside the nub. It stops being
 * approximate the moment a key stops being an equal share, which is the one
 * change to the rail that has to come back here.
 */
const TONGUE: Record<AdpBayId, string> = {
  leagues: "16.67%",
  window: "50%",
  curve: "83.33%",
};

/**
 * One bay, floating over the board.
 *
 * **It is a panel and not a `<dialog>`, and that is a decision rather than an
 * omission.** A modal dialog makes everything behind it inert, and the board
 * behind this one is the thing a bay exists to be watched against — the curve is
 * dragged while the value column bends underneath, and the draft count in the
 * header is the needle the window moves. So it takes the league-filters dialog's
 * *material* (a raised face over the recessed rail, the grammar this app uses for
 * the thing you are working in sitting above the thing you are working on) and
 * none of its modality. What that costs is the three behaviours a `<dialog>`
 * gives away free, and each is written by hand at the call site: Escape closes
 * the bay before the drawer ({@link drawerKeyAction}), a press outside dismisses
 * it, and focus goes back to the key it came from.
 *
 * **That argument is what the Leagues bay leans on hardest**, since what it holds
 * is the whole league-filters panel — a control that was a modal `<dialog>` over
 * the entire page at its two other call sites, and that reached this drawer as a
 * key opening one *over the board it narrows*. Drawn here it is the same panel
 * with its modality dropped: the board is not inert, the drawer's own footer and
 * header are still there, and Escape and a press outside still resolve to the bay
 * first. A bay's contents may be as large as they need to be; what they may not
 * be is a second modal.
 *
 * It hangs off the pinned block rather than being positioned in the panel:
 * `top-full` is the block's own bottom edge, so nothing measures anything and a
 * block that grows a line still puts its bays directly under itself. The board
 * below is untouched — it keeps scrolling, keeps re-pricing, and a press on it
 * closes the bay. **A bay bounds its own height**, since this box does not: the
 * window and curve bays are short by construction and the Leagues bay caps
 * itself, which is what keeps a panel that hangs off a fixed edge from running
 * off the bottom of the drawer.
 */
export function AdpBay({
  id,
  bay,
  label,
  children,
}: {
  id: string;
  bay: AdpBayId;
  /** Names the group for a reader who arrives inside it by Tab. */
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      // `mt-1.5` clears the block's own bottom border, so the tongue has ground
      // to stand on rather than growing out of a line.
      className="adp-bay absolute inset-x-4 top-full z-10 mt-1.5 rounded-xl border border-active/25 bg-gradient-to-b from-[#1b3040] to-[#0d1c27] p-2.5 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.95),0_0_36px_-16px_rgba(0,255,229,0.35)]"
      style={{ animation: "dialog-rise 0.16s cubic-bezier(0.2,0.9,0.3,1)" }}
    >
      {/* The nub joining the bay to the key that opened it. A rotated square
          showing two of its borders, so it is the panel's own edge turning a
          corner rather than a triangle drawn beside it — which is what makes it
          read as one part with the panel at any zoom. */}
      <span
        aria-hidden
        style={{ left: TONGUE[bay] }}
        className="absolute -top-[5px] h-[9px] w-[9px] -translate-x-1/2 rotate-45 rounded-[1px] border-l border-t border-active/25 bg-[#1b3040]"
      />
      {children}
    </div>
  );
}
