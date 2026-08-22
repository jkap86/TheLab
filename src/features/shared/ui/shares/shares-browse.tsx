"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import { closeSheet, latchSheet } from "../../sheet-latch.ts";
import type { SubjectKind } from "../../subjects.ts";
import type { SubjectView } from "../../subject-view.ts";

/**
 * The two shares browses, each loaded the first time it is opened.
 *
 * One is the Players tab's whole apparatus and the other the Leaguemates tab's —
 * the share cards, the metric catalogue, the columns editor behind the heading
 * rail, and for the players one the ADP board — none of which is on screen until
 * a key is pressed. `ssr: false` for the reason the columns editor takes it: a
 * dialog nobody has opened has no server-rendered state worth having.
 *
 * **Two `dynamic()` calls rather than one shell imported once**, because the seam
 * worth splitting is the one a reader actually stops at: most open one browse and
 * never the other, and the players half carries the whole ADP apparatus the
 * leaguemates half has no column for. Measured, that is 6.8KB and 6.5KB against
 * ~9KB for a single chunk holding both.
 *
 * The cost is that `SharesSheet` is inlined into *each* of them — webpack does
 * not hoist a module shared by two async chunks into a third — so a reader who
 * opens both pays for the shell twice. That is the right way round: it is ~4KB
 * duplicated for the minority who browse both, against ~2KB of dead catalogue and
 * reads for everyone who browses one. Worth re-measuring if the shell ever grows
 * into the larger half of a chunk.
 */
const PlayerSharesSheet = dynamic(
  () => import("./player-shares-sheet").then((m) => m.PlayerSharesSheet),
  { ssr: false },
);

const LeaguemateSharesSheet = dynamic(
  () => import("./leaguemate-shares-sheet").then((m) => m.LeaguemateSharesSheet),
  { ssr: false },
);

/** Which browse is up and how to change that — see {@link useSharesBrowse}. */
export type SharesBrowse = {
  /**
   * The browse on screen, if either.
   *
   * One value rather than a flag apiece: both are modal, so two open at once is
   * unrepresentable rather than merely avoided — and whatever door opened one is
   * behind it, so a reader cannot reach the other key to try.
   */
  open: SubjectKind | null;
  /** Which have ever been opened, and so which chunks have been downloaded. */
  mounted: readonly SubjectKind[];
  /** Put one up, latching its chunk in — both writes in one batched update. */
  show: (kind: SubjectKind) => void;
  /** Take one down, from the sheet's own way out. */
  hide: (kind: SubjectKind) => void;
};

/**
 * The disclosure behind the two shares browses: which is up, and which have ever
 * been.
 *
 * **It is a hook and a component rather than either half alone, because the
 * browses have two doors and the doors are in different files.** The subject
 * rail's own pair of keys is one; the leagues page's view keys, which replaced
 * the links to the Players and Leaguemates routes, are the other
 * ({@link ManagerViewDrawers}). Both need the same three things — the latch, the
 * open kind and the two dynamic imports — and a second copy of them is two
 * readers of one selection that agree until somebody edits one: the obvious way
 * it would drift is a third kind, or a change to what `onClose` clears.
 *
 * The state is not lifted any higher than the door, deliberately. Nothing outside
 * a door needs to know a browse is up, and the two doors are never on screen at
 * once — the rail's keys are suppressed exactly where the view keys are drawn, so
 * there is no page holding both and no selection to keep in step between them.
 */
export function useSharesBrowse(): SharesBrowse {
  const [open, setOpen] = useState<SubjectKind | null>(null);
  /**
   * Latched *per kind* rather than once for both, because mounting is what
   * downloads the chunk: a reader who only ever browses players must not pay for
   * the leaguemates list's catalogue and reads.
   */
  const [mounted, setMounted] = useState<readonly SubjectKind[]>([]);

  /**
   * **Both writes are here rather than one of them in a render body.** The latch
   * was once applied as `if (open && !mounted.includes(open)) setMounted(…)`
   * while rendering — a render-phase update, so opening a browse re-ran the whole
   * door synchronously before React committed anything, in the same frame as the
   * dialog mounting, a lazy chunk evaluating and (for players) the roster and ADP
   * reads starting. In a press handler the two setters are one batched update.
   */
  const show = useCallback((kind: SubjectKind) => {
    setMounted((m) => latchSheet(m, kind));
    setOpen(kind);
  }, []);

  // Clears only its own kind: a sheet closing is the last thing that happens on
  // the way out of it, so clearing flatly would have one dialog's exit cancel
  // whatever had just been asked for — pressing Leaguemates while the players
  // browse is on its way down.
  const hide = useCallback((kind: SubjectKind) => {
    setOpen((current) => closeSheet(current, kind));
  }, []);

  // One object per change rather than one per render: the rail hands its own
  // `openSheet` this, so a fresh literal every time would make that callback —
  // and every dependency list downstream of it — move on renders nothing here
  // caused.
  return useMemo(
    () => ({ open, mounted, show, hide }),
    [open, mounted, show, hide],
  );
}

/**
 * The browses themselves, mounted for whichever kinds have been opened.
 *
 * Rendered by the door that owns the state — it is a subtree of the page rather
 * than of the key, since a `<dialog>` lives in the top layer wherever it is
 * written and the key is a 26px part in a row.
 */
export function SharesBrowseSheets({
  view,
  browse,
}: {
  view: SubjectView;
  browse: SharesBrowse;
}) {
  const { open, mounted, hide } = browse;
  return (
    <>
      {mounted.includes("player") && (
        <PlayerSharesSheet
          view={view}
          open={open === "player"}
          onClose={() => hide("player")}
        />
      )}

      {mounted.includes("leaguemate") && (
        <LeaguemateSharesSheet
          view={view}
          open={open === "leaguemate"}
          onClose={() => hide("leaguemate")}
        />
      )}
    </>
  );
}
