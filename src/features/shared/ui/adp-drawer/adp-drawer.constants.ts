import type { AdpBoardType, ManagerLeague } from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";

import type { AdpControls } from "../../adp-controls";
import type { FilterSpec } from "./adp-drawer.types.ts";

/**
 * The board's grids, written out whole so Tailwind can see them, and shared by
 * the heading row and the rows under it — a header laid out separately drifts
 * the moment a width changes, the same rule the roster panel's `SectionLayout`
 * holds. One board is the classic six columns; both boards trade the Taken
 * column for a second ADP one (its share moves to the ADP cells' hover), and
 * seat the two value columns only from `@md` up — four numeric columns on a
 * phone leave a name ~58px, which is no name at all. The `@` variants measure
 * the drawer panel itself (it is the `@container`), not the viewport, since the
 * panel is narrower than the screen everywhere a laptop is involved.
 *
 * They are constants rather than anything built at render time for a second
 * reason: a class Tailwind cannot read as a literal string is a class it does
 * not emit, so the grid would simply not exist in the stylesheet.
 */
export const BOARD_COLUMNS_ONE =
  "grid-cols-[1.75rem_1fr_2rem_2.75rem_2.5rem_3.25rem]";
export const BOARD_COLUMNS_BOTH =
  "grid-cols-[1.75rem_1fr_2rem_2.75rem_2.75rem] @md:grid-cols-[1.75rem_1fr_2rem_2.75rem_2.75rem_3.25rem_3.25rem]";

/** One frozen empty, so the default `seedLeagues` keeps a stable identity. */
export const EMPTY_LEAGUES: readonly ManagerLeague[] = [];

/** Likewise for the board while nothing has loaded, so the rows memo holds. */
export const EMPTY_PLAYERS: readonly AdpPlayerPayload[] = [];

/**
 * The drawer's entrance and its exit, in milliseconds.
 *
 * They differ because the two are not one gesture run backwards: arriving is
 * eased out over a longer beat so the panel settles where it lands, leaving is
 * eased in and shorter, since a dismissed control's job is to get out of the
 * way. The keyframes are in `globals.css` (Tailwind v4 has no per-component
 * mechanism) and the timing is here with the rest of the app's — the same split
 * `dialog-rise` and its call sites use.
 *
 * **They are roughly twice the app's other animations, which is deliberate.**
 * `dialog-rise` runs 140–180ms because it is a fade and 10px of travel: it is
 * over before it registers, and that is right for a panel that simply appears.
 * This one crosses the whole width of the drawer, and at those durations it read
 * as an instant swap — the movement was there and nobody saw it. A slide only
 * says where a panel came from if the eye can follow it, so the distance sets
 * the duration.
 *
 * The exit is the number the component itself needs: it is how long the drawer
 * stays mounted after `open` goes false, so there is something for the exit to
 * play on. That is a **timer** rather than an `animationend` listener because
 * under `prefers-reduced-motion` there is no animation, so no event would ever
 * fire and a drawer closed once would stay mounted forever; the reduced-motion
 * block hides it outright instead, which is what makes waiting out a beat there
 * cost nothing. See {@link useAdpDrawerLifecycle}, which owns that timer.
 */
export const ADP_DRAWER_ENTER_MS = 460;
export const ADP_DRAWER_EXIT_MS = 340;

// What *kind* of draft, which is a round count underneath: a startup fills a
// roster, a rookie draft is a handful of rounds. It replaced a snake/linear/auction
// chip in this slot — the room's picking order is not a fact about the market it
// priced, where a startup's 1.01 and a rookie draft's 1.01 are different players.
const ROUNDS_FILTER: FilterSpec = {
  key: "rounds",
  ariaLabel: "Kind of draft",
  options: [
    { value: "all", label: "All drafts" },
    { value: "full", label: "Startup (12+ rds)" },
    { value: "rookie", label: "Rookie (≤5 rds)" },
  ],
  get: (c) => c.rounds,
  set: (c, v) => ({ ...c, rounds: v as AdpControls["rounds"] }),
};

/**
 * The filters whose options are fixed — everything but league size, which is
 * read off the population the caller supplies (see `leagueSizeFilter`).
 *
 * No league-type filter in this table any more: the fetch answers the redraft
 * and dynasty markets side by side, and which is drawn is the board keys' job
 * over the list itself — a display choice, not a narrowing.
 */
export const FIXED_FILTERS: readonly FilterSpec[] = [
  ROUNDS_FILTER,
  {
    key: "scoring",
    ariaLabel: "Scoring",
    options: [
      { value: "all", label: "All scoring" },
      { value: "std", label: "Standard" },
      { value: "half_ppr", label: "Half PPR" },
      { value: "ppr", label: "PPR" },
    ],
    get: (c) => c.scoring,
    set: (c, v) => ({ ...c, scoring: v as AdpControls["scoring"] }),
  },
  {
    key: "superflex",
    ariaLabel: "Quarterbacks started",
    options: [
      { value: "all", label: "SF & 1QB" },
      { value: "yes", label: "Superflex" },
      { value: "no", label: "1QB" },
    ],
    get: (c) => c.superflex,
    set: (c, v) => ({ ...c, superflex: v as AdpControls["superflex"] }),
  },
  {
    key: "bestBall",
    ariaLabel: "Format",
    options: [
      { value: "all", label: "BB & lineup" },
      { value: "no", label: "Lineup" },
      { value: "yes", label: "Best ball" },
    ],
    get: (c) => c.bestBall,
    set: (c, v) => ({ ...c, bestBall: v as AdpControls["bestBall"] }),
  },
];

/** How a board is spelled where there is room for a word rather than a letter. */
export const BOARD_NAMES: Record<AdpBoardType, string> = {
  redraft: "Redraft",
  dynasty: "Dynasty",
};
