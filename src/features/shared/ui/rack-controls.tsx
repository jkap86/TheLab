"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// A sibling module in this folder, and that is what lets `RackControls` name
// the union at all: `SubjectKind` lived in `features/manager` when this seam
// was written, and `features/shared` may not read a sibling feature, so the two
// legal values were spelled out here instead. It moved here with the shares
// drawer, and the spelled-out copy went with it.
import type { SubjectKind } from "../league-subjects";

/**
 * Everything the app rack needs to draw a page's Browse controls.
 *
 * The rack is mounted in `layout.tsx`, above `{children}`, so it cannot see the
 * state of the page under it — and the keys it carries are page-specific. This
 * is the seam: a page publishes, the rack consumes, and a page that publishes
 * nothing renders no controls at all. It is the same rule `app-rack.tsx`
 * already applies to the tools page's menu.
 *
 * **It carried six more fields until the View track came off the rack** — the
 * filter state and its setter, the unfiltered league list, the column
 * selection, the KTC market and its scrape stamp. Those controls are on the
 * manager page's own identity plate now, where the state already lives, so
 * nothing crosses this seam for them and they are gone from the type rather
 * than left published and unread: a field nobody reads is a field the next
 * reader of either file has to prove is dead.
 *
 * `drawer` rides along with `onOpenDrawer` because the Browse keys report which
 * drawer is open (`aria-expanded`, and the lit state that goes with it); the
 * drawers themselves stay mounted on the page, where their state lives.
 *
 * **The keys are data now, where they used to be two legends written into
 * `features/tools`.** That was tolerable while one page published controls and
 * both its drawers were named in the rack's own markup; it stopped being so the
 * moment a second page published a different pair, because the rack would then
 * have carried every page's vocabulary and a `switch` on the route to choose
 * between them. A page names its own keys and the rack only mounts them —
 * which is the same rule this seam already exists for, one grain further in.
 */
export type RackControls = {
  /**
   * The Browse keys this page offers, in the order the rack draws them.
   *
   * **Hand over a stable array**, per the note on
   * {@link usePublishRackControls}: a literal rebuilt each render republishes
   * each render. A module-level constant is what both pages use, since the
   * legends are fixed.
   */
  keys: readonly RackDrawerKey[];
  /** Which of them is open, or null. */
  drawer: SubjectKind | null;
  onOpenDrawer: (kind: SubjectKind) => void;
};

/** One key: which drawer it opens, and what it says. */
export type RackDrawerKey = {
  kind: SubjectKind;
  /** The legend, in the page's own words — "Players", "Opponents". */
  label: string;
};

/**
 * The rack's page-published controls, and who owns them.
 *
 * **This was `RackReadoutProvider`**, which carried the lit pill naming whose
 * page you were on. The pill is gone — the identity plate names the manager and
 * the season now, so the pill was a second answer to a question already
 * answered, and its ~185px is exactly what the control tracks needed.
 * The provider was the right *shape* for what replaced it, so it was extended
 * rather than deleted: one object published upward into one rack, with the same
 * argument about where the truth lives.
 *
 * Read and write are two contexts on purpose. A publisher takes only the
 * setter, which is stable, so the page does not re-render itself every time it
 * moves its own controls.
 */
const ReadContext = createContext<RackControls | null>(null);
const WriteContext = createContext<
  ((controls: RackControls | null) => void) | null
>(null);

export function RackControlsProvider({ children }: { children: ReactNode }) {
  const [controls, setControls] = useState<RackControls | null>(null);
  return (
    <WriteContext.Provider value={setControls}>
      <ReadContext.Provider value={controls}>{children}</ReadContext.Provider>
    </WriteContext.Provider>
  );
}

/** What the rack should be carrying, or null on a page that publishes nothing. */
export function useRackControls(): RackControls | null {
  return useContext(ReadContext);
}

/**
 * Publish this page's controls to the rack for as long as it is mounted.
 *
 * In an effect rather than during render, because it writes to an ancestor's
 * state and React forbids that on the way down.
 *
 * **Every field is a dependency, and that is load-bearing rather than
 * pedantic.** The object handed to `publish` is new on every render, so an
 * effect that depended on the object would run on every render, set state on an
 * ancestor, re-render this page, and run again — an unbounded loop rather than
 * a stale value. Depending on the fields instead means the effect fires only
 * when one of them actually moves, which requires the *caller* to hand over
 * stable identities: `onOpenDrawer` is a `useCallback` in `LeaguesHome` for
 * exactly this reason, and everything else is either a primitive or a piece of
 * state.
 *
 * The cleanup is the half that matters — without it, walking from a manager
 * page to `/trades` would leave the previous page's keys in the rack, wired to
 * a component that has unmounted.
 */
export function usePublishRackControls(controls: RackControls): void {
  const publish = useContext(WriteContext);
  const { keys, drawer, onOpenDrawer } = controls;

  useEffect(() => {
    if (!publish) return;
    publish({ keys, drawer, onOpenDrawer });
    return () => publish(null);
  }, [publish, keys, drawer, onOpenDrawer]);
}
