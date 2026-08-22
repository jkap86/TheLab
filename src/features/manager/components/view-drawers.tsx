"use client";

import {
  SharesBrowseSheets,
  useSharesBrowse,
} from "@/features/shared/ui/shares/shares-browse";
import type { SubjectView } from "@/features/shared/subject-view";
import { toolsInGroup } from "@/features/shared/tools";
import {
  VIEW_KEY,
  VIEW_KEY_FACE,
  VIEW_ROW,
  VIEW_ROW_LIST,
  ViewKeyFace,
} from "@/features/shared/ui/view-switch";

/**
 * The account's other two views, over the leagues page rather than away from it:
 * Players down the left, Leaguemates down the right, and the league list still
 * on screen between them.
 *
 * **It is what the three-cell switch is on this one page, and the Leagues cell
 * going is the point rather than a saving.** That switch draws the view you are
 * on as a cut-in seat — a cell that says "you are here" and does nothing when
 * pressed — which is honest where the three are three routes and is a cell
 * spent on nothing once the other two stop being routes to leave by. What is
 * left is two keys, both of which do something, over a list that never goes
 * away: the browse opens beside the leagues rather than instead of them, so a
 * subject picked in it narrows a list the reader can watch narrow. That is the
 * whole argument for the drawer shape — see {@link SharesSheet}.
 *
 * Four things hold it up.
 *
 * **The row is derived from the tools catalogue, not from a list of two.** A
 * manager view that is a ranked list of subjects declares which
 * (`Tool.browses`), and this row is the views that declared one — so Leagues is
 * absent because a league is the page rather than a subject on it, not because
 * this file filtered it out by name. A fourth view joins by declaring what it
 * browses, exactly as it joins the switch by joining the group. The names, the
 * glyphs and the order are the catalogue's for the reason {@link ViewSwitch}'s
 * are: a second list of them drifts the day a view is renamed.
 *
 * **The keys are the switch's own cells, to the class.** They are buttons rather
 * than links now, which is the only difference a reader should be able to find:
 * the wall, the face, the glyph seat and the type step are `VIEW_KEY` and its
 * neighbours, imported rather than retyped, so the row a reader meets on the
 * Players *route* and the row they meet here are one part.
 *
 * **Each browse keeps its own side, and the row is drawn in the order they are
 * anchored.** Players is the catalogue's first manager view after Leagues and
 * opens from the left; Leaguemates follows it and opens from the right. Which
 * side is `SharesSheet`'s (the variants declare it, so both doors onto a browse
 * agree), and what this row owns is only that the keys are in the same order —
 * a left key opening a right drawer is a panel that appears to come from
 * nowhere.
 *
 * **The state is the rail's state.** `useSharesBrowse` is the same latch and the
 * same open kind the subject rail drives its own keys with; this page suppresses
 * that pair (`SubjectRail`'s `browse`) so there is exactly one door onto each
 * browse on screen, and both doors are the same button wherever a page draws
 * them.
 */
export function ManagerViewDrawers({ view }: { view: SubjectView }) {
  const browse = useSharesBrowse();
  const views = toolsInGroup("Manager").filter((tool) => tool.browses);

  return (
    <>
      {/* A group rather than a `nav`: nothing here goes anywhere. It keeps the
          switch's own box so the two rows are interchangeable in the layout —
          the header above and the filter rail below are laid against this
          clearance and this left edge. */}
      <div role="group" aria-label="Manager views" className={VIEW_ROW}>
        <ul className={VIEW_ROW_LIST}>
          {views.map((tool) => {
            // Narrowed by the filter above — `browses` is what put the tool in
            // this list — which TypeScript cannot see through `filter`.
            const kind = tool.browses!;
            return (
              <li key={tool.pattern} className="flex">
                <button
                  type="button"
                  onClick={() => browse.show(kind)}
                  aria-haspopup="dialog"
                  aria-expanded={browse.open === kind}
                  className={VIEW_KEY}
                >
                  <span className={VIEW_KEY_FACE}>
                    <ViewKeyFace tool={tool} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <SharesBrowseSheets view={view} browse={browse} />
    </>
  );
}
