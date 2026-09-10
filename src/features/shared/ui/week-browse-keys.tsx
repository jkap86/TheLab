import type { RackDrawerKey } from "./rack-controls";

/**
 * The two Browse keys a **week** tool puts in the rack: their legends, and the
 * glyphs the rack draws them as below `md`.
 *
 * **Both week tools publish this one array**, which is where it parts company
 * with the manager page's own `browse-marks.tsx`. That file's rule — a page owns
 * its glyph as it owns its legend, because the rack cannot `switch` on the route
 * — is about what the *rack* can see, and it is unchanged: the keys are still
 * data a page publishes. What changed is that there are two publishers of the
 * same pair. The lineup checker and gametime answer the same two questions over
 * the same leagues with the same two subject kinds, so a legend or a drawing
 * that differed between them would be one fact drawn two ways on two pages a
 * reader walks between — the drift the `starter`/`opponent` vocabulary exists to
 * prevent. It is the "second reader" line `CONSOLE_KEY`, `ManagerPlate` and
 * `SharesDrawer` itself all moved here on.
 *
 * **Module scope, not a literal in a render**, which is the requirement
 * `usePublishRackControls` states rather than a habit: the publish effect
 * depends on this array, so one rebuilt each render would publish each render,
 * set an ancestor's state and re-render — a loop rather than a stale value. The
 * two `icon` elements are built once here for the same reason, and being
 * elements rather than components is what makes that possible at all.
 *
 * **The pair has to read as a pair**, which is what shaped both: the two drawers
 * are your starters and the lineups they play, so one glyph is a player with a
 * mark on him and the other is two players facing. A drawing that only made
 * sense on its own would leave a reader deciding which of two accent caps is
 * which by position.
 *
 * The handoff calls the second one "Opposing", which is what it draws; it is
 * named for the key it sits on, because the label, the subject kind and the
 * drawer it opens all say `opponent` and a second word for one drawer is the
 * drift a tool's own vocabulary exists to prevent.
 */
/**
 * A player with a check: the lineup you have set, and whether it is right — the
 * question the lineup checker's four checks answer, one seat at a time.
 *
 * The figure is offset left rather than centred, which is what leaves the check
 * a corner of its own; centred, the two overlap and the mark reads as part of
 * the shoulder line.
 */
export function StartersMark() {
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
      <circle cx="10" cy="7.6" r="3" />
      <path d="M4 19.5c0-3.3 2.7-5.6 6-5.6 1 0 1.9.2 2.7.6" />
      <path d="M14.4 17.2l2.2 2.2 4-4.6" />
    </svg>
  );
}

/**
 * Two players facing, yours filled and theirs outlined.
 *
 * **The fill is the whole of what it says.** Two outlined figures are
 * `LeaguematesMark` — people you share a league with — where this is the one
 * you play *against* this week, and a solid figure opposite a hollow one is the
 * only way 17px has of drawing a side. The mirror is what makes it a fixture
 * rather than a crowd.
 */
export function OpponentsMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[1.0625rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="6.6" cy="8" r="2.6" fill="currentColor" stroke="none" />
      <path
        d="M2.4 19c0-2.7 1.9-4.6 4.2-4.6s4.2 1.9 4.2 4.6"
        fill="currentColor"
        stroke="none"
      />
      <circle cx="17.4" cy="8" r="2.6" />
      <path d="M13.2 19c0-2.7 1.9-4.6 4.2-4.6s4.2 1.9 4.2 4.6" />
    </svg>
  );
}

/**
 * The pair, as the rack takes it — see the module note for why one array serves
 * both week tools and why it must stay at module scope.
 */
export const WEEK_BROWSE_KEYS: readonly RackDrawerKey[] = [
  { kind: "starter", label: "Starters", icon: <StartersMark /> },
  { kind: "opponent", label: "Opponents", icon: <OpponentsMark /> },
];
