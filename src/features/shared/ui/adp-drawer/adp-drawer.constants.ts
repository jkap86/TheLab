import type { AdpBoardType, ManagerLeague } from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";
import type { KtcValue } from "@/shared/ktc";

import { DEFAULT_ADP_ROUNDS } from "../../adp-controls";
import { scaledPx } from "../../font-scale.ts";

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
 *
 * **The KTC pair is a tail at `@lg`, and both halves of that are arithmetic
 * rather than taste.** It is a *tail* because a collapsible column added in the
 * middle moves every column after it as the panel crosses the tier — the reader
 * watches the board step sideways — where one appended at the trailing edge
 * leaves everything already on screen exactly where it was. And it is `@lg`
 * (32rem) rather than the `@md` the value columns use because the densest state
 * is both boards plus both values plus both KTC columns, which is nine:
 *
 *     fixed   1.75 + 2.25 + 3 + 3 + 3.25 + 3.25 + 2.5 + 2.5 = 21.5rem
 *     gaps    8 × `gap-2`                                   =  4rem
 *     chrome                                                = 408px
 *
 * against a 36rem panel's 536px of row (the panel, less its `px-4` and the
 * list's own `px-1`), which leaves the name **128px** — about what a roster row
 * gets on a phone, where `Christian McCaffrey` measures 127px. At the 32rem
 * panel this drawer used to be, that same state left 64px, which is no name at
 * all; the panel is 36rem for exactly this reason. Single-board at `@lg` is
 * eight columns, 348px of chrome, and a 188px name.
 *
 * **Three tracks are a step wider than they were, and every one of those steps
 * is the headings becoming controls** rather than a change of mind about the
 * numbers: a lit heading carries a direction caret after its label, and that
 * caret costs 10.4px. Measured in headless Chromium against the real `woff2`
 * and the compiled type — the practice this codebase keeps for a fixed track,
 * because both failure modes are invisible in review — `ADP R ▲` is 44.1px
 * against the 44px track `ADP R` fitted, `Taken ▲` is 46.3 against 40, and
 * `Pos ▲` is 33.6 against 32. All three clipped *inside their own word* the
 * moment the column was sorted, which reads as broken where a clipped name only
 * reads as long. So the fixed tracks give way (2 → 2.25, 2.75 → 3, 2.5 → 3) and
 * the name, which truncates gracefully, absorbs it — the roster panel's own
 * rule about which field should lose a fight for width.
 *
 * **That measurement is also why the KTC headings are `SF` and `1QB` rather
 * than `KTC SF` and `KTC 1QB`.** The longer pair is 45.7px and 56.1px with a
 * caret, and buying them their own width costs 40px out of a name that has 128
 * — so the source moves to the hover and the accessible name ({@link ktcTitle}),
 * where there is room to say `KeepTradeCut` properly and to state the caveat
 * that matters far more than the attribution: it is a *dynasty* board whichever
 * ADP column it is sitting beside.
 *
 * A narrower window keeps the old board's shape: below `@lg` the KTC pair is
 * absent, below `@md` the value pair is too, and a phone draws precisely the six
 * (or five) columns it always did — a little tighter, since those three tracks
 * widen at every tier. One board on a 390px phone leaves the name 98px against
 * the 114 it had, which still holds `Ja'Marr Chase` (92.4px); both boards there
 * are 158px against 162.
 *
 * **The single-board template carries one more track than it used to**, seated at
 * `@md`: the auction column, 2.25rem, between Taken and Value. Its own arithmetic
 * — why that tier, why that width, and why the both-boards template is untouched
 * — is on {@link AUCTION_COLUMN_SEAT}. The short version is that the densest
 * single-board state is now nine columns, 400px of chrome and a **143px** name,
 * which clears the 128px the both-boards state already lives at.
 */
export const BOARD_COLUMNS_ONE =
  "grid-cols-[1.75rem_1fr_2.25rem_3rem_3rem_3.25rem] @md:grid-cols-[1.75rem_1fr_2.25rem_3rem_3rem_2.25rem_3.25rem] @lg:grid-cols-[1.75rem_1fr_2.25rem_3rem_3rem_2.25rem_3.25rem_2.5rem_2.5rem]";
export const BOARD_COLUMNS_BOTH =
  "grid-cols-[1.75rem_1fr_2.25rem_3rem_3rem] @md:grid-cols-[1.75rem_1fr_2.25rem_3rem_3rem_3.25rem_3.25rem] @lg:grid-cols-[1.75rem_1fr_2.25rem_3rem_3rem_3.25rem_3.25rem_2.5rem_2.5rem]";

/**
 * The seat the auction column wears, on its heading and on its cells alike.
 *
 * **`@md` rather than the KTC pair's `@lg`, and the arithmetic is the reason.**
 * The column is 2.25rem — the position column's width, which is what `Bid ▲`
 * measures at (three uppercase characters plus a caret is 33.6px against a 36px
 * track, the same fit `Pos ▲` gets) and comfortably more than the widest cell,
 * `100%` at 28.8px. Seated a tier lower it would arrive on a 390px phone, where
 * the single-board row has 350px and the name is already down to 98px: 52px of
 * column and gap takes that to 46, which is no name at all. At `@md` the panel is
 * at least 448px and the KTC pair has not arrived yet, so the name has 112px
 * there and 143px at the full 36rem panel with every column up — above the 128px
 * the both-boards state already accepts.
 *
 * It is in **single-board mode only**, which is the Taken column's own rule and
 * for the same reason: two more numeric columns is what the both-boards row has
 * no width for, and a share of *which* market is not a question one column can
 * answer. With both boards up the number moves to each ADP cell's hover, exactly
 * as Taken's share does.
 *
 * The band this costs is 513–530px, where the KTC pair has just arrived and the
 * name is briefly under 100px — the non-monotonicity a tier that adds a column
 * always buys. `block` rather than `inline-block` for the reason
 * {@link KTC_COLUMN_SEAT} spells out: Tailwind v4 emits the display utilities
 * alphabetically, so `.hidden` beats `.block` and loses to every `.inline*`.
 */
export const AUCTION_COLUMN_SEAT = "hidden @md:block";

/**
 * The seat a KTC column wears, on a heading and on a cell alike.
 *
 * One string because the two have to cross the tier together — a heading seated
 * a tier apart from the column under it is a label over the wrong numbers, which
 * is invisible in review and obvious on screen. `block` rather than
 * `inline-block`: Tailwind v4 emits the display utilities alphabetically, so
 * `.hidden` beats `.block` (which is what makes this hide at all) and loses to
 * every `.inline*`.
 */
export const KTC_COLUMN_SEAT = "hidden @lg:block";

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
 *
 * **Which is exactly why it cannot stay a literal 33 under `--app-font-scale`.**
 * Every term of that arithmetic is `rem` — the line box, the padding — and only
 * the 1px border is not, so the row the browser lays out grows with the type
 * while a hardcoded number does not: at a scale of 1.125 the content is ~36px in
 * a 33px box, which is a clipped board *and* the per-row drift this constant
 * exists to prevent. So the 32 rem-derived pixels are scaled and the border is
 * added after, and it is a getter rather than a value because the scale is read
 * off the document and there is nothing to read at module-evaluation time on the
 * server. Both readers — the row's own `style` and the virtualizer's
 * `estimateSize` — call it, so they still cannot disagree.
 */
export const adpRowHeight = (): number => scaledPx(32) + 1;

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
 * The draft-kind row the board seats inside the league-filters panel.
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
 * panel's trough rather than beside it, so the board's filters are one control
 * rather than a control and a stray chip.
 *
 * The row and nothing else: the draft it edits and the write that lands it are
 * {@link AdpLeagueFiltersPanel}'s, because this row and the rules beside it are
 * two fields of one stored `AdpControls` and applying them separately is how one
 * of the two writes reverts the other.
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
