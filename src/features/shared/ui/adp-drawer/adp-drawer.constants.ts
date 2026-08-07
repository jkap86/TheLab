import type { AdpBoardType, ManagerLeague } from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";
import type { KtcValue } from "@/shared/ktc";

import { DEFAULT_ADP_ROUNDS } from "../../adp-controls";

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

/**
 * The `<li>` every row of the board wears, whichever kind of row it is.
 *
 * Written once because a player row and a pick row sit in one windowed list at
 * one fixed {@link ADP_ROW_HEIGHT}: a difference in the padding or the border
 * between the two would drift the rows off the offsets the virtualizer places
 * them at, which is a whole screen of drift a thousand rows down. The two grids
 * are the constants above for the same reason the heading shares them — a header
 * laid out separately drifts the moment a width changes.
 */
export const BOARD_ROW_CLASS = (both: boolean) =>
  `absolute inset-x-0 top-0 grid ${both ? BOARD_COLUMNS_BOTH : BOARD_COLUMNS_ONE} items-center gap-2 border-t border-foreground/[0.04] px-1 py-1.5 text-sm`;

/**
 * One board row's height in px, which the row is *given* rather than measured
 * for — see {@link AdpBoardRow}, which writes it onto every `<li>`.
 *
 * It is the height the row already had, and it is arithmetic rather than a
 * guess: a 20px line box (`text-sm`, whose line-height is the tallest thing in
 * the grid — the position badge is 18.9px and every numeric cell is `text-xs` at
 * 16px), plus `py-1.5` either side, plus the 1px top border. A row cannot be any
 * other height, because the name is `truncate`d to one line and no cell wraps.
 *
 * Pinning it is what lets the list be windowed with a fixed size rather than a
 * measured one: the rows are absolutely positioned at multiples of this number,
 * so a constant that merely *estimated* the height would drift a pixel per row
 * — a thousand rows deep, a whole screen of it. Written on the element, the
 * constant is true by construction and the two cannot disagree.
 */
export const ADP_ROW_HEIGHT = 33;

/**
 * How many rows are mounted either side of the visible window.
 *
 * Twelve is ~400px of board, which is what a flick covers between the scroll
 * event and the re-render that answers it. It also absorbs the one place the
 * virtualizer's arithmetic is approximate: the board's sticky head sits between
 * the scroll box's own origin and the list's, and `scrollMargin` is measured
 * rather than known ahead of time — so a header that rewraps between
 * measurements shifts the computed range by a row or two, and the overscan is
 * what keeps that invisible.
 */
export const ADP_ROW_OVERSCAN = 12;

/**
 * The viewport the virtualizer assumes before it has measured the real one.
 *
 * It matters only where there is nothing to measure — a static render, which is
 * how the drawer is tested — since in a browser the measurement runs in a layout
 * effect and lands before the first paint. Zero (the library's default) makes
 * `calculateRange` answer *no rows at all*, so a server-rendered board would be
 * an empty list rather than a screenful; 640px is a plausible drawer, and being
 * wrong about it costs one over-rendered frame at worst.
 */
export const ADP_BOARD_INITIAL_RECT = { width: 0, height: 640 } as const;

/** One frozen empty, so the default `seedLeagues` keeps a stable identity. */
export const EMPTY_LEAGUES: readonly ManagerLeague[] = [];

/** Likewise for the board while nothing has loaded, so the rows memo holds. */
export const EMPTY_PLAYERS: readonly AdpPlayerPayload[] = [];

/**
 * And for KTC's pick rows, which is also what a board answers with when KTC is
 * unsynced — the pick rows then hold the current class and nothing beyond it,
 * since a season KTC has no opinion about cannot be discounted.
 */
export const EMPTY_PICK_KTC: Readonly<Record<string, KtcValue>> = {};

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

/**
 * The draft-kind row the board seats inside the league-filters dialog.
 *
 * What *kind* of draft, which is a round count underneath: a startup fills a
 * roster, a rookie draft is a handful of rounds. It replaced a
 * snake/linear/auction chip in this slot — the room's picking order is not a
 * fact about the market it priced, where a startup's 1.01 and a rookie draft's
 * 1.01 are different players.
 *
 * **It is the one control of this board's that is not a league rule**, which is
 * why it is an `ExtraSegment` rather than a field of `LeagueFilters`: how many
 * rounds a room ran is a fact about the room, and the manager tabs and the
 * trades board would inherit a filter that means nothing to them. Seated in the
 * dialog's trough rather than beside its trigger, so the board's filters are one
 * dialog rather than a dialog and a stray chip.
 *
 * `value` and `onApply` are the caller's — this is the half that doesn't vary.
 */
export const ROUNDS_SEGMENT = {
  label: "Drafts",
  options: [
    { value: "all", label: "All drafts" },
    { value: "full", label: "Startup (12+ rds)" },
    { value: "rookie", label: "Rookie (≤5 rds)" },
  ],
  defaultValue: DEFAULT_ADP_ROUNDS,
} as const;

/** How a board is spelled where there is room for a word rather than a letter. */
export const BOARD_NAMES: Record<AdpBoardType, string> = {
  redraft: "Redraft",
  dynasty: "Dynasty",
};
