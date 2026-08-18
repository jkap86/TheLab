import type { ReactNode } from "react";

import type { HeaderSyncSummary } from "./manager-header.types.ts";
import { partialSyncNote } from "./manager-header.utils.ts";

/**
 * The three standing caveats about the rows below, as plates riding the card's
 * bottom edge.
 *
 * **It was a row in the plate's flow, and that was the bug.** Present only when
 * there was something to say, it made the card ~24px taller the moment a refresh
 * started and ~24px shorter when it ended — so the entire league list moved twice
 * on every visit, once in each direction, for a band most readers never look at.
 * Absolutely positioned, the card is one height forever and the list never moves.
 *
 * **What it no longer carries is the refresh**, which went to the readout slot
 * (see {@link SyncFlask}). The split is the one in {@link hasSyncCaveat}: a
 * refresh is a process with a running count that resolves on its own, and these
 * three are facts about data already on screen that resolve by nothing. Sharing a
 * row made them look like one kind of thing, and gave the loudest treatment to
 * the one that goes away by itself.
 *
 * **The plates are siblings of the slab, never children of it.** `clip-path`
 * clips a whole subtree, so a part rendered inside the face would be severed at
 * the exact edge it exists to straddle — which is why {@link ManagerHeader} keeps
 * a plain `relative` wrapper around the slab, and why its comment has always said
 * that is what the wrapper is for.
 *
 * The edge they ride is not free: the record bar's bottom clears it by 10px and
 * these plates rise 14px above it, so the body reserves a 12px lane
 * (`bodyPadding`). Reserving it *permanently* is the point — a lane that appeared
 * with the caveat would be the layout shift this whole change is about.
 */
export function SyncCaveats({
  summary,
  refreshError,
}: {
  summary?: HeaderSyncSummary;
  refreshError?: string | null;
}) {
  const partial = partialSyncNote(summary);
  return (
    <div
      // Every plate here is something the page cannot otherwise be told apart
      // from a complete one: leagues that failed, a list another sync is still
      // filling in, a refresh that gave up on data already served.
      role="status"
      // `pointer-events-none` because a plate hanging off the card's edge sits
      // over the gap above the subject rail, and nothing here is pressable —
      // a press meant for the rail below must not land on a label.
      className="pointer-events-none absolute -bottom-3 left-[calc(1.25rem+1px)] right-[calc(1.25rem+1px)] z-[5] flex flex-wrap items-center gap-1.5"
    >
      {/* Some leagues could not be refreshed, so the list below is a mix of
          just-synced rows and rows as old as the last pass. Stated as the two
          counts rather than the failure alone — see `partialSyncNote`. */}
      {partial && <Caveat>{partial}</Caveat>}
      {/* A sync running elsewhere kept this one from writing, so the list below
          is whatever that one has committed so far — on a first visit, a
          fraction of it. Said out loud for the reason the failed-league count
          is: the page cannot otherwise be told apart from a complete one. */}
      {summary?.locked && (
        <Caveat>Syncing elsewhere — this list may be incomplete</Caveat>
      )}
      {refreshError && <Caveat>Refresh failed — showing cached data</Caveat>}
    </div>
  );
}

/**
 * One caveat, on the card's own edge-plate device.
 *
 * A plate rather than the bordered text pill this used to be, because off the
 * card's edge there is no card behind it — a pill with a hairline border and a
 * 10%-alpha fill was legible against the plate's face and is a floating outline
 * against the page ground. It is `.lab-nameplate`'s construction in the caution
 * tone: same lit top edge, same 2px wall, so it reads as stamped on the part
 * rather than dropped near it.
 *
 * It stays a *plate* and never a chip: raised-means-press-me is about keys and
 * pills, and there is nothing to press here.
 */
function Caveat({ children }: { children: ReactNode }) {
  return (
    <span className="lab-nameplate-warn rounded-[5px] px-2.5 py-[3px] text-[0.6875rem] font-semibold leading-tight text-amber-50">
      {children}
    </span>
  );
}
