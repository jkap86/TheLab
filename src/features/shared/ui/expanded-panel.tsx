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
 * view kept its own `CONSOLE_HOUSING_INSET` block until it converged on this
 * one; both that constant and `--housing-inset-shadow` are noted dead where
 * they are declared rather than deleted.
 *
 * **It is a component of its own so `league-card.tsx` stays hook-free**, which
 * is that file's own stated design and `LeagueSyncKey`'s precedent one tool
 * over. The card renders a housing; this is the housing, with the sizing it
 * cannot do for itself.
 *
 * **It lives in `features/shared/ui` because a trade card mounts it too**, on
 * the line `CONSOLE_KEY`, `ManagerPlate`, `LeagueConfigWindow` and
 * `LeagueTeams` all moved on: a second reader, and a sibling feature may not
 * import from `features/manager`. The lineup checker's week view is the third.
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
 * of this component for one reason: an expanded half with a different inset
 * could take the arithmetic without taking this chrome, and a shared component
 * taking a `className` for the difference would put two base `p-*` utilities of
 * the same specificity in one class attribute — settled by Tailwind's emit
 * order rather than by the caller. That was the lineup checker's own half until
 * it converged here; the seam stays because it is what a fourth shape would
 * take.
 */
export function ExpandedPanel({
  children,
  open,
  closing,
  seamEnd,
}: {
  children: ReactNode;
  /** Whether the card's disclosure is open — see `useActiveCard`. */
  open: boolean;
  /** Whether it is closing: open for as long as the collapse takes. */
  closing: boolean;
  /**
   * A control to hang on the right end of the cut, inside the panel's own
   * gutter — today the manager and trade cards' `History` key.
   *
   * **The seam is a row rather than a bare rule because of what it saves.**
   * The key it carries used to sit in a 32px recess strip of its own with a
   * 10px margin under it, present whether or not the reader had ever opened
   * the history — 42px of a capped panel spent on one key and a sentence,
   * against a seam that was 28px of cut and margin doing nothing else. Folded
   * together they are ~41px once, and the ~29 that buys is two more standings
   * rows and another seat. The strip comes back at its full height the moment
   * the key is pressed, which is the one time it has a rail to hold.
   *
   * **It is gated on `mounted` with the children**, so a card that has never
   * been opened has no key in the document and no tab stop hidden inside a
   * closed disclosure.
   */
  seamEnd?: ReactNode;
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
      // on — and the seam below cancels it to run edge to edge, as the pane
      // row inside `LeagueTeams` now does for its own reason. A column, so the
      // rail holds its height, the browser takes the rest and the two panes
      // scroll their own lists — see `Pane`.
      //
      // **The foot is 10px, where it was the gutter's own 14/18.** It is the
      // one inset on the panel that nothing is measured against — the side
      // padding lines the panes up with the rank windows above them, and the
      // seam's margins are the breath around the cut, but the bottom is only
      // clearance between the last row and the card's edge. Ten reads as that
      // and hands the difference to the glass.
      className="relative box-border flex flex-col overflow-hidden px-3.5 pb-2.5 sm:px-[1.125rem] pointer-fine:[perspective:1400px]"
      style={style}
    >
      {/* The seam. It is the panel's first child rather than the summary's
          last, because it exists only while the expanded half does: a closed
          card is one housing with nothing to cut in two.

          **It is a row now, not a rule**, so a control can sit on the cut —
          see `seamEnd` for what that folds away. The row breaks the panel's
          padding exactly as the bare groove always did, and it is the *key*
          that carries the gutter back as its own right margin rather than the
          row carrying it as padding: with no key the cut runs wall to wall,
          which is what it does today and what the lineup checker's panel — the
          one caller with no key to hang — must keep. The mock insets both ends
          of the cut; that would narrow it on a card this change does not
          otherwise touch, and the panes below it now run to the wall, so the
          rule reaching further than they do is the wrong way round.

          The margins are the breath around it: 8px either side, against the
          `12/18` and `10/14` the two halves used to spend separately. */}
      <div className="-mx-3.5 my-2 flex shrink-0 items-center gap-2.5 sm:-mx-[1.125rem] sm:gap-3">
        <span
          aria-hidden
          className="h-0.5 min-w-0 flex-1 bg-[image:var(--card-seam-groove)]"
        />
        {mounted && seamEnd ? (
          <span className="mr-3.5 shrink-0 sm:mr-[1.125rem]">{seamEnd}</span>
        ) : null}
      </div>
      {/* **Nothing is rendered while the card is shut** — see `usePanelCap`'s
          `mounted` for the measurement. The children are still *created* by the
          caller either way, which is only a descriptor object; what this saves
          is mounting the subtree they describe. */}
      {mounted ? children : null}
    </div>
  );
}
