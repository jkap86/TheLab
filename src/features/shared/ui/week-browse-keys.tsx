import type { RackDrawerKey } from "./rack-controls";

/**
 * The Browse key a **week** tool carries: its glyph, and the legend each tool
 * gives it.
 *
 * **The glyph is one drawing and the legend is two**, which is where this
 * parts company with what it used to be. It was a single `WEEK_BROWSE_KEYS`
 * array both tools published, on the argument that the lineup checker and
 * gametime ask the same question over the same leagues with the same subject
 * kind, so a legend that differed between them would be one fact drawn two
 * ways on two pages a reader walks between.
 *
 * That is right about the *drawing* and was wrong about the word, and what
 * shows it is a parameter the panel behind this key has taken since gametime
 * became its second reader: `figureLabel` is `Proj` on the checker and `Live`
 * on gametime, because the figure beside every player is a projection on one
 * page and what he has scored and is on course for on the other. The panel
 * really does answer two questions, so `Start/Sit` and `Player Scores` are two
 * honest names for it rather than drift — and the shared mark is what still
 * says it is one panel. A reader who walks between the tools meets the same
 * object under the name the page they are on would give it.
 *
 * **They are two module-level constants rather than one factory**, and the
 * reason survives the move off the rack. `usePublishRackControls` required a
 * stable array — a literal rebuilt each render published each render, set an
 * ancestor's state and re-rendered, which is a loop rather than a stale value.
 * `BrowseDock` is one component rather than an ancestor, so what a fresh array
 * costs there is a re-render of it rather than a loop; the requirement is
 * softer and the answer is the same, because a constant is free. The `icon`
 * element is built once here on the same terms, and being an element rather
 * than a component is what makes that possible at all.
 *
 * **It used to be two keys**, `Starters` docking left and `Opponents` docking
 * right, over two panels that each read one side of the week. One panel lists
 * every player once with four readings beside him, so a second cap would open
 * a drawer that is already open — see `WeekSharesDrawer`.
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
 *
 * **It is named for what it draws rather than for what it says**, which is the
 * whole of why one mark can carry two legends: it was `BothSidesMark`, after a
 * legend neither tool uses now.
 */
export function WeekPlayersMark() {
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
 * The lineup checker's key. What its panel answers is which of a week's
 * lineups a player is on and what the seat opposite him did — a start/sit
 * call, made before the games.
 */
export const START_SIT_BROWSE_KEYS: readonly RackDrawerKey[] = [
  { kind: "week", label: "Start/Sit", icon: <WeekPlayersMark /> },
];

/**
 * Gametime's. The same panel over the same leagues, with the week in progress:
 * the figure beside each player is what he has scored and is on course for, so
 * what the key opens is a board of scores rather than a decision.
 */
export const PLAYER_SCORES_BROWSE_KEYS: readonly RackDrawerKey[] = [
  { kind: "week", label: "Player Scores", icon: <WeekPlayersMark /> },
];
