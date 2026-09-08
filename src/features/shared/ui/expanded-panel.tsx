"use client";

import { type ReactNode } from "react";

import { CONSOLE_HOUSING_INSET_SHELL } from "../console-chrome";
import { usePanelCap } from "../use-panel-cap";

/**
 * The expanded half of a card: an inner housing that fills what the parked
 * shell has left under the card's own header, and collapses again when the
 * card closes.
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
      // housing's own padding and border are inside it rather than added to it,
      // which is Tailwind's default and is stated here because the number
      // depends on it.
      //
      // A column, so the rail holds its height, the browser takes the rest and
      // the two panes scroll their own lists — see `Pane`. `overflow-hidden`
      // comes with the housing and is what keeps a pane's own scroller inside
      // the 14px radius.
      className={`${CONSOLE_HOUSING_INSET_SHELL} mt-3.5 flex flex-col rounded-[0.875rem] p-1.5 sm:p-3 pointer-fine:[perspective:1400px]`}
      style={style}
    >
      {/* **Nothing is rendered while the card is shut** — see `usePanelCap`'s
          `mounted` for the measurement. The children are still *created* by the
          caller either way, which is only a descriptor object; what this saves
          is mounting the subtree they describe. */}
      {mounted ? children : null}
    </div>
  );
}
