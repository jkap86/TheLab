import type { RackDrawerKey } from "./rack-controls";

/**
 * The Browse key a **week** tool puts in the rack: its legend, and the glyph
 * the rack draws it as below `md`.
 *
 * **Both week tools publish this one array**, which is where it parts company
 * with the manager page's own `browse-marks.tsx`. That file's rule — a page owns
 * its glyph as it owns its legend, because the rack cannot `switch` on the route
 * — is about what the *rack* can see, and it is unchanged: the keys are still
 * data a page publishes. What changed is that there are two publishers of the
 * same key. The lineup checker and gametime answer the same question over the
 * same leagues with the same subject kind, so a legend or a drawing that
 * differed between them would be one fact drawn two ways on two pages a reader
 * walks between — the drift the `week` vocabulary exists to prevent. It is the
 * "second reader" line `CONSOLE_KEY`, `ManagerPlate` and `SharesDrawer` itself
 * all moved here on.
 *
 * **It used to be two keys**, `Starters` docking left and `Opponents` docking
 * right, over two panels that each read one side of the week. One panel lists
 * every player once with four readings beside him, so a second cap would open
 * a drawer that is already open — see `WeekSharesDrawer`. The ~44px of rack
 * width that frees is what the wordmark's own conditional can have back at 390.
 *
 * **Module scope, not a literal in a render**, which is the requirement
 * `usePublishRackControls` states rather than a habit: the publish effect
 * depends on this array, so one rebuilt each render would publish each render,
 * set an ancestor's state and re-render — a loop rather than a stale value. The
 * `icon` element is built once here for the same reason, and being an element
 * rather than a component is what makes that possible at all.
 */

/**
 * One side of the game, and the sheet of both.
 *
 * A filled figure beside a small lined panel: the figure is a player on a
 * lineup, filled because that is how the pair this replaces drew the manager's
 * own side, and the panel is the list that now carries both sides at once. The
 * two halves are what say it is a *reading* of the week rather than a lineup —
 * a second figure opposite would have drawn the two panels this key replaced.
 *
 * The rules on the panel are drawn at a lighter stroke than its own frame, so
 * at 17px they read as ruled lines rather than as a filled block.
 */
export function BothSidesMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[1.0625rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="7.6" cy="7.2" r="2.5" fill="currentColor" stroke="none" />
      <path
        d="M3.6 17.2c0-2.5 1.8-4.3 4-4.3s4 1.8 4 4.3"
        fill="currentColor"
        stroke="none"
      />
      <rect x="14" y="5.4" width="6.4" height="13.2" rx="1.4" />
      <path d="M15.6 9.2h3.2M15.6 12.4h3.2M15.6 15.6h3.2" strokeWidth={1.2} />
    </svg>
  );
}

/**
 * The key, as the rack takes it — see the module note for why one array serves
 * both week tools and why it must stay at module scope.
 */
export const WEEK_BROWSE_KEYS: readonly RackDrawerKey[] = [
  { kind: "week", label: "Both sides", icon: <BothSidesMark /> },
];
