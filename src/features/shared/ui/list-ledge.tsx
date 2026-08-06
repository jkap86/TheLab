import type { ReactNode } from "react";

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
 * The stat-column headings have always ridden here ({@link MetricHeadings}); the
 * subject filter is the second storey above them. **The point of one billet is
 * that a separate part costs more than its own contents**: its wall, its cast
 * shadow, and the clearance holding its lit face off the rail's lit face — the
 * same 20px the manager plate's filters key gave back by seating flush in its
 * corner. Two storeys pay those once, and say something true while they are at
 * it: both are the list's header, one naming its columns and one naming its
 * population.
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
 */
export function ListLedge({
  storey,
  headings,
  panel,
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
}) {
  // The last storey drawn is the one that carries the billet's bottom edge.
  const seated = storey ? "lab-ledge-face-seated lab-notch-br" : "lab-notch-lg";

  return (
    // The cards' own geometry: the same left inset and trailing gutter, plus the
    // 1px transparent border the cards spend on their own — without it every
    // heading would sit a pixel off the number it names.
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
  );
}
