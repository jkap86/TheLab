"use client";

import { type ReactNode } from "react";

import { usePanelCap } from "../use-panel-cap";

/**
 * The expanded half of a card: the part of the card under the seam, sized to
 * fill what the parked shell has left under the card's own header, and
 * collapsed again when the card closes.
 *
 * **It paints no surface of its own, and that is the expanded-card pass's
 * whole change to it.** It was `CONSOLE_HOUSING_INSET_SHELL` — a 1px border,
 * `--housing-bg` and `--housing-inset-shadow` at a 14px radius, 14px under the
 * summary — which is a card inside a card: the panes, the rail and the drawer
 * bars read as tiles inside a second housing set into the first. Now the
 * card's own housing shows through behind them and the two halves are one
 * piece of stock separated by a **milled groove** (`--card-seam-groove`), the
 * band drawn where the border was, run edge to edge by negative margins equal
 * to the card's gutter. The summary above lost its bottom padding for the same
 * reason — while the card is open; see the cards for the `group-open` rule.
 *
 * What survives of the shell is what the cap and the collapse depend on:
 * `box-sizing: border-box`, `overflow-hidden` and the perspective. The clip
 * has nothing to round against any more and is kept anyway — a mid-animation
 * drawer still must not paint over the card's edge. The lineup checker's week
 * view keeps its own `CONSOLE_HOUSING_INSET` block, and `--housing-inset-shadow`
 * with it; only the two readers of this component closed the seam.
 *
 * **It is a component of its own so `league-card.tsx` stays hook-free**, which
 * is that file's own stated design and `LeagueSyncKey`'s precedent one tool
 * over. The card renders a housing; this is the housing, with the sizing it
 * cannot do for itself.
 *
 * **It lives in `features/shared/ui` because a trade card mounts it too**, on
 * the line `CONSOLE_KEY`, `ManagerPlate`, `LeagueConfigWindow` and
 * `LeagueTeams` all moved on: a second reader, and a sibling feature may not
 * import from `features/manager`.
 *
 * **`parked` is gone, and so is the park itself.** This used to scroll its own
 * card under the rack on open and carry a second cap for the trade card, which
 * did neither. Every card parks now and the *list* is what parks it — see
 * {@link useActiveCard} — because what changes on open is the whole page: the
 * header stands down, the other cards stand down, and the shell the panel sizes
 * itself into is the list's own box. A panel that scrolled the page would be a
 * second thing moving it.
 *
 * All of the measuring is {@link usePanelCap}, which is a hook rather than part
 * of this component for one reason: the lineup checker's expanded half is a
 * `CONSOLE_HOUSING_INSET` block with its own inset, and a shared component
 * taking a `className` for that difference would put two base `p-*` utilities
 * of the same specificity in one class attribute — settled by Tailwind's emit
 * order rather than by the caller. Each half keeps its own chrome; they share
 * the arithmetic.
 */
export function ExpandedPanel({
  children,
  open,
  closing,
}: {
  children: ReactNode;
  /** Whether the card's disclosure is open — see `useActiveCard`. */
  open: boolean;
  /** Whether it is closing: open for as long as the collapse takes. */
  closing: boolean;
}) {
  const { ref, style, mounted } = usePanelCap<HTMLDivElement>(open, closing);

  return (
    <div
      ref={ref}
      // `box-sizing: border-box` is what makes the cap mean what it says: the
      // panel's own padding is inside it rather than added to it, which is
      // Tailwind's default and is stated here because the number depends on
      // it. The groove below is inside the box too — the cap arithmetic is
      // unchanged, and measures a panel 14px taller for the same viewport than
      // the housing it replaced.
      //
      // **The horizontal inset is the card's own gutter and nothing more.**
      // The housing is the `<details>` and this is its bottom half, so the
      // panel carries the same `14px` / `18px` the summary above it does —
      // which is what puts the panes' edges on the line the rank windows end
      // on — and the groove below cancels it to run edge to edge. A column, so
      // the rail holds its height, the browser takes the rest and the two
      // panes scroll their own lists — see `Pane`.
      className="relative box-border flex flex-col overflow-hidden px-3.5 pb-3.5 sm:px-[1.125rem] sm:pb-[18px] pointer-fine:[perspective:1400px]"
      style={style}
    >
      {/* The seam. It is the panel's first child rather than the summary's
          last, because it exists only while the expanded half does: a closed
          card is one housing with nothing to cut in two. Its top margin is the
          breath the summary's bottom padding used to give the windows above it,
          and its bottom margin is the panel's own top inset — `12px 0 18px` on
          a desktop, `10px 0 14px` on a phone — so the two are one spelling
          with the groove between them. */}
      <span
        aria-hidden
        className="-mx-3.5 mb-2.5 mt-3 h-0.5 shrink-0 bg-[image:var(--card-seam-groove)] sm:-mx-[1.125rem] sm:mb-3 sm:mt-3.5"
      />
      {/* **Nothing is rendered while the card is shut** — see `usePanelCap`'s
          `mounted` for the measurement. The children are still *created* by the
          caller either way, which is only a descriptor object; what this saves
          is mounting the subtree they describe. */}
      {mounted ? children : null}
    </div>
  );
}
