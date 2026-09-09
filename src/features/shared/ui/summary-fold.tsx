"use client";

import type { ReactNode } from "react";

/**
 * A reading on a card's summary that folds away while the card is open.
 *
 * An open card is the screen — the list stands down around it and the page
 * stops scrolling — so the expanded half gets whatever the viewport has left
 * after the summary, and on a laptop that was two lineups reading through a
 * ~500px slot. The readings folded with this are the ones that are only
 * useful on a *shut* card: a standing scanned beside a hundred other
 * standings, four checks read down a column. Folded, what they free the panel
 * takes; the card's own height does not move. See `useSummaryReadings` for the
 * one boolean that decides it, and `SummaryReadingsKey` for the key that
 * flips it.
 *
 * **It is a transitioned `max-height` (or `max-width`) under a clip**, with
 * the opacity and the margin moving beside it. The cap values the callers hand
 * in are caps *above* the real content heights — measured: a strip is ~37px,
 * a window row ~102 on a desktop and ~86 on a phone — and exist to give the
 * transition something to animate to, never to clip. A negative margin in the
 * folded state is what cancels the gap the parent column gives the item: a
 * collapsed flex item still takes its share of a `gap`, so without it the fold
 * leaves an 8px band behind.
 *
 * **The transition list is one string in both states**, on `CollapseTray`'s
 * rule: rewriting `transition` in the same frame as the animated property
 * cancels the transition. Every axis the two callers between them animate is
 * named, so a wrapper that folds vertically and one that folds sideways share
 * the one spelling and neither carries a list the other lacks. The two state
 * strings are the caller's, **whole**, because a base plus an override is two
 * utilities of one specificity settled by Tailwind's emit order rather than by
 * the class attribute — the trap `CONSOLE_KEY_PILL` and `CONSOLE_CARD_SHELL`
 * are both split to keep a part out of. `.lab-anim` is the app's one
 * reduced-motion hook and clears the transition outright there, so the fold
 * lands in one frame and nothing else about it changes.
 *
 * **`inert` while folded.** Nothing in either reading is focusable, so this is
 * for what a screen reader is handed rather than for the tab order: a reading
 * at opacity 0 under a 0px clip is still in the accessibility tree, and a
 * reader would be read four checks the page has put away. `inert` takes the
 * subtree out of it, and comes off with the fold.
 *
 * **The clip is `overflow: hidden`, as the design draws it, and it costs the
 * casts under the parts.** A strip's `--standing-strip-shadow` throws a 2px
 * cast and two soft ones below it, and a window's `--window-shadow` ends in a
 * 1px lit lip; a wrapper clipped to the part's own box cuts both. `overflow:
 * clip` with a clip margin would keep them and would show a band of the part
 * itself past the shrinking box for the length of the fold, which is a worse
 * artefact on every press than a lost cast is on a dark housing at rest. The
 * mock takes the same trade.
 *
 * **The `translateZ` the wrapped part carried moves onto this wrapper**, and
 * that is a requirement on the caller rather than a nicety. The summary is
 * `preserve-3d` and projects its *direct children*; a wrapper between it and
 * a transformed row is a flat rendering context, so the row's own `translateZ`
 * would compute against no projection at all, with no error to say so. A
 * transform on the wrapper itself projects fine — the clip flattens what is
 * *inside* it, and nothing inside a strip or a window row carries a plane of
 * its own.
 */
export function SummaryFold({
  folded,
  className = "",
  shownClassName,
  foldedClassName,
  children,
}: {
  folded: boolean;
  /** The wrapper's own layout in both states — a plane, a flex role. */
  className?: string;
  /** The whole of the shown state: the caps, the margins, `opacity-100`. */
  shownClassName: string;
  /** The whole of the folded state: zero caps, the cancelled gap, `opacity-0`. */
  foldedClassName: string;
  children: ReactNode;
}) {
  return (
    <div
      inert={folded}
      className={`lab-anim overflow-hidden [transition:max-height_320ms_cubic-bezier(0.2,0.8,0.2,1),max-width_320ms_cubic-bezier(0.2,0.8,0.2,1),opacity_240ms_ease,margin_320ms_cubic-bezier(0.2,0.8,0.2,1)] ${className} ${
        folded ? foldedClassName : shownClassName
      }`}
    >
      {children}
    </div>
  );
}
