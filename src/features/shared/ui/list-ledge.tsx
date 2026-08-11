"use client";

import type { ReactNode } from "react";

import { usePinnedHeight } from "./pinned-height.ts";

/**
 * The list's own header, as one machined billet — one storey or two.
 *
 * It lives in `features/shared` because a second list wears it: the lineup
 * checker heads its own rows with the same rail, and a billet drawn twice is two
 * chances for the material to drift. `features/manager` re-exports it from where
 * that tool's own components already import it, the usual mover's rule. What it
 * knows about either tool is nothing — it owns the wall, the notch and the faces,
 * and takes whatever goes on them as nodes.
 *
 * The stat-column headings ride here ({@link MetricHeadings}); a caller may put
 * one storey above them. **A separate part costs more than its own contents** —
 * its wall, its cast shadow, and the clearance holding its lit face off this
 * one's, the same 20px the manager plate's filters key gave back by seating
 * flush in its corner — so a storey is the cheap way to carry a second row, and
 * it is the right way exactly when that row and the headings are one header.
 *
 * **The manager tool's subject filter was that storey and is not now, which is
 * the limit of the trick worth knowing.** A storey and a heading rail are the
 * same material at the same width with a 1px seam between them, so a filter
 * drawn there read as part of the table's own head rather than as a control over
 * it — and the pinned region ran three lit faces deep. It is a slab of its own
 * above this billet now (see `SubjectRail`), and what still uses the storey is
 * the shares sheet, where the tokens name the rows the list is *about* and there
 * is genuinely one header to be part of. The test is not whether a second row
 * exists; it is whether it is saying the same kind of thing as the headings.
 *
 * Three details are load-bearing and easy to undo.
 *
 * **A billet has one top edge.** The storey at the top wears the three-stop
 * chamfer (`.lab-ledge-storey`); the one under the seam wears
 * `.lab-ledge-face-seated`, which drops it and picks the light back up below the
 * cut. Both chamfered would draw two top edges on one part, which is the tell
 * that a billet is really two boxes touching.
 *
 * **The notch is split with the storeys.** A parent's `clip-path` clips its whole
 * subtree, so the wrapper's `.lab-notch-lg` already cuts the top-left of whatever
 * is at the top; what it cannot reach is an inner face's own bottom-right, which
 * sits 5px above the wrapper's. So the *last* storey carries the bottom-right cut
 * and no other — `.lab-notch-br` where there is a storey above it,
 * `.lab-notch-lg` where it is the only one.
 *
 * **The panel is outside the billet, and it has to be.** That same `clip-path`
 * would cut off anything floating below the rail, so the search panel is a
 * sibling of the billet inside this component's `relative` box rather than a
 * child of it. Which is why this owns the wrapper at all.
 *
 * **Over a list, it is the one part of the page's header that pins** — see
 * {@link pinnedBox}. The manager plate and the filter row above it scroll away
 * with the page; a heading rail cannot, because it is the only thing naming four
 * columns of bare numbers a hundred rows deep.
 */
export function ListLedge({
  storey,
  headings,
  panel,
  pinned = false,
  fade = true,
}: {
  /** The upper storey — the subject filter. Omitted, the rail is what it was. */
  storey?: ReactNode;
  /**
   * The heading cells, as the face's contents rather than as a face — see
   * {@link MetricHeadings}. Omitted where the list has no rows to head, which is
   * exactly when the storey above still has to be reachable.
   */
  headings?: ReactNode;
  /** A floating panel hung under the rail, clear of the billet's own clip. */
  panel?: ReactNode;
  /**
   * Whether this rail holds the top of the page while the list scrolls under
   * it — see {@link pinnedBox}, which is what that costs.
   *
   * False is the shares sheet, where the rail is already inside a dialog that
   * scrolls its own list and there is nothing above it to scroll away.
   */
  pinned?: boolean;
  /**
   * Whether the pinned rail's ground fades out below itself rather than ending.
   * Meaningless unpinned, and it normally does — the argument is on
   * {@link pinnedBox}.
   *
   * A page lowers it while a row below has pinned an *opaque* surface flush
   * against the rail: an expanded league card does exactly that, and there the
   * fade has nothing to blend into and only washes out the head of the one thing
   * being read. It is a prop rather than something this works out, because the
   * rail can see nothing below itself; only the page knows whether one of its
   * rows has taken the screen.
   */
  fade?: boolean;
}) {
  // The last storey drawn is the one that carries the billet's bottom edge.
  const seated = storey ? "lab-ledge-face-seated lab-notch-br" : "lab-notch-lg";
  // Published for the open league card, which pins directly under this rail.
  // Only while this rail is the one holding the top — see {@link usePinnedHeight}.
  const ref = usePinnedHeight<HTMLDivElement>(pinned);

  return (
    <div ref={ref} className={pinned ? pinnedBox(fade) : undefined}>
      {/* The cards' own geometry: the same left inset and trailing gutter, plus
          the 1px transparent border the cards spend on their own — without it
          every heading would sit a pixel off the number it names. */}
      <div className="relative border border-transparent px-4 pl-5">
        {/* The wall, run to the width of the cards below it — the rail is the
            list's header, so it covers the list. */}
        <div className="lab-ledge lab-notch-lg flex w-full flex-col">
          {storey && (
            // It **wraps rather than compresses**: at 390px a caption, a token, a
            // trigger and the count do not fit on one line, and everything in the
            // row is content rather than chrome — so the storey takes a second
            // line down there instead of pushing the count off the end of the
            // billet, which is what a nowrap row did.
            <div
              className={`lab-ledge-storey relative flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-1.5 py-1.5 ${
                headings ? "" : "lab-notch-br"
              }`}
            >
              {storey}
            </div>
          )}

          {/* The cut between the storeys: dark on top, lit underneath — the groove
              rule the columns' `divide-x` keeps, run horizontally. A 1px element
              rather than a border, since a border would change both storeys'
              boxes and they each own their padding. */}
          {storey && headings && (
            <span aria-hidden="true" className="lab-ledge-seam h-px w-full" />
          )}

          {headings && (
            // `relative` is what the face's own cyan seam (`::before`) hangs off;
            // the material classes deliberately carry no `position`.
            //
            // `divide-x` is the groove's dark cut, and it is spelled here rather
            // than in the material class because a border changes the box: the
            // cards' own columns carry the same 1px *inside* their box, so without
            // it every heading after the first would sit a pixel left of the
            // number it names — four pixels shared out unevenly below `sm`, where
            // the columns divide the row rather than taking a fixed width. The lit
            // far wall that turns that cut into machining is `.lab-ledge-col`'s
            // inset highlight.
            <div
              className={`lab-ledge-face ${seated} relative flex w-full items-stretch divide-x divide-[rgba(0,0,0,0.5)]`}
            >
              {headings}
            </div>
          )}
        </div>

        {panel}
      </div>
    </div>
  );
}

/**
 * The box that holds the rail under the app bar while the list scrolls past it.
 *
 * **It is the rail and nothing above it, which is the whole of this change.**
 * The manager plate, the season, the record and the filter row used to pin with
 * it — one sticky box, because the rail rode inside the plate's own header. That
 * put a card's worth of facts about the account on screen permanently, paid for
 * out of the list, to keep four column headings from scrolling away. The plate is
 * a card at the top of the page now and reads once; the rail is what a reader
 * still needs at row ninety, so the rail is what stays.
 *
 * Four things hold it up:
 *
 * **Its parent has to span the list.** A sticky element travels only as far as
 * its own parent's box, so seated inside the header — or inside any box that
 * wraps it and the filter row and stops — it would scroll away with that box and
 * stick nowhere. It is a sibling of the header and of the list, which makes its
 * parent the page shell's `<main>`: the box the rows are in. The trades board's
 * pinned seek key is the same rule, arrived at the same way.
 *
 * **It paints the page's ground, and the rail alone would not be enough.** The
 * billet is opaque but it is inset from the cards' own edges (its wrapper's
 * `px-4 pl-5`, so the headings land over the numbers), so a card scrolling under
 * a bare rail shows through the gutters either side of it. The fill covers the
 * whole box, gutters included.
 *
 * **That fill ends against the ambient aurora, so it fades rather than
 * stopping — on the sides as well as below.** A flat edge of `--background`
 * across the page reads as the glow behind it being clipped, and for a while
 * only the bottom edge answered that: the two sides ended hard, so at rest the
 * rail sat in a visible rectangle of cut-out glow. They ramp now too
 * (`.lab-ledge-ground`), and the one thing that decides is *where*: the ramp
 * runs outward across the `-mx-4 px-4` bleed into `PageShell`'s own gutter,
 * which is card-free, so every pixel the fill was already covering stays fully
 * opaque. Ramping inward from the box's own edge would have softened the same
 * edge by exposing the cards it exists to hide.
 *
 * The bleed and the padding cancel, so the billet inside is laid out exactly
 * where it was — what widens is only the painted box. `pointer-events-none` on
 * the fade because it overhangs the list.
 *
 * **`z-30` is a window, not a spare number.** Below it is an expanded league
 * card, which pins under this rail at `z-20` and must not paint over it; above
 * it is the subject rail's search panel, which hangs *down* over this one and
 * would otherwise be painted under it. The app bar is above them all at `z-50`.
 *
 * The margins are the clearance this part used to get from a `gap` in the box it
 * no longer has: 12px above, holding it off the filter rail's lit face, and 6px
 * of painted ground plus 12px below before the first row. The rail above carries
 * the same 12px on its own bottom edge — adjacent margins collapse, so that is
 * one gap and not two — because it is drawn without this billet whenever the
 * filters leave no rows, and each part holding itself off the next is what makes
 * both arrangements land on the same number. At rest they space the part; pinned
 * the top one is ignored, since the offset is measured from the scrollport rather
 * than from the box's own position.
 */
const pinnedBox = (fade: boolean) =>
  `lab-ledge-ground sticky top-[var(--site-header-h)] z-30 -mx-4 mb-3 mt-3 px-4 pb-1.5 ${
    fade
      ? "after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-10 after:bg-gradient-to-b after:from-[var(--background)] after:to-transparent"
      : ""
  }`;
