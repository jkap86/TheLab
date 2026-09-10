import type { ReactNode } from "react";

import {
  CONSOLE_BILLET,
  CONSOLE_GLASS,
  CONSOLE_PANE_TRACK,
  CONSOLE_WINDOW_LEDGE,
} from "../console-chrome";
import { Scanlines } from "./card-plate";

/**
 * One half of an expanded league card's browser, as a **part**: milled stock
 * carrying a ledge and a sheet of glass.
 *
 * The expanded half used to be a lit window holding more lit windows, which
 * flattened the rail, both panes and the pick plates into one sheet of
 * readings. A pane is an object now — the same three-surface grammar the card
 * itself wears one plane up (housing, ledge, glass), which is what lets a
 * reader tell a control that belongs to *this* list from one that belongs to
 * the card.
 *
 * **It lives in its own module because both panes are drawn from two files.**
 * `LeagueTeams` draws the standings and `LineupBreakdown` the roster, and the
 * second is rendered *by* the first — so a `PaneGlass` exported from
 * `league-teams.tsx` and imported back by the breakdown is an import cycle. The
 * surfaces have to sit beside both rather than inside either, which is the same
 * reason `card-plate.tsx` exists one level up. {@link PaneRow} sits beside them
 * for exactly that reason a second time — and for a third: the bench rows are
 * the breakdown's, the pick rows are `draft-picks.tsx`'s and the breakdown
 * imports that file, while the checker and gametime are sibling features that
 * may reach `features/shared` and not each other.
 *
 * **`DrawerRow` used to live here and is gone.** It was one of four row
 * components that had drifted apart; all four are {@link PaneRow} now, and a
 * drawer's rows are that part with `ground="drawer"` — one step less cast,
 * since they sit on a part rather than on glass. Everything the *drawer* is
 * made of is untouched: {@link DrawerBar}, {@link PaneDrawer},
 * {@link DRAWER_BAR_HEIGHT} and the `--bars` sums do not move.
 */

/**
 * The row every pane draws, re-exported here because this module is the door
 * onto a pane's pieces and a caller that already imports `Pane`, `PaneGlass`
 * and `PaneDrawer` should not have to know that the row lives in a file of its
 * own. It has one because it is long enough to be one, and because its own
 * argument — why a row is a part rather than a channel — belongs beside it.
 */
export {
  PaneRow,
  type PaneRowFace,
  type PaneRowFigure,
  type PaneRowLead,
  type PaneRowStatus,
} from "./pane-row";

/**
 * The part itself.
 *
 * `min-w-0 flex-1` — **equal width, not a percentage split**. The standings
 * pane was 40% and the roster 60%, which was the right division when the roster
 * carried a ghost column and two comparison bars per seat; with those gone the
 * two hold the same number of cells and the same names, and an uneven split
 * reads as one of them having been cut short.
 *
 * **It is a fixed-height column**, which is what lets the card cap its expanded
 * half to the viewport and scroll the two lists inside it rather than pushing a
 * hundred-league page. The ledge is `shrink-0` and the glass takes what is left
 * — see {@link PaneGlass} — so a twelve-team standings and a ten-seat roster
 * end at the same line however many rows each of them holds.
 *
 * `min-h-0` is the half of that which is silent when it is missing: a flex item
 * refuses to shrink below its own content by default, so without it the pane
 * grows to its rows' full height, the cap has nothing to bite on and neither
 * list ever scrolls.
 *
 * `@container` is what sizes the team marks inside it: `Avatar size="sm"` grows
 * with the *panel* rather than the viewport, which is the right axis here — a
 * pane on a wide card has room for a 24px mark and the same pane on a phone
 * does not, whatever the window around it is doing.
 */
export function Pane({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${CONSOLE_BILLET} @container relative flex min-h-0 min-w-0 flex-1 flex-col rounded-xl p-0.5 lg:p-1.5`}
    >
      {children}
    </div>
  );
}

/**
 * A pane's machined header: its own control, and the heads of the columns
 * below it.
 *
 * The ledge is what makes a control belong to a pane rather than to the card —
 * `CONSOLE_WINDOW_LEDGE`'s own argument for a rank window's words, one grain
 * up: a control on the same surface as the rows it orders is a peer of them,
 * and a control on a ledge above them is plainly *theirs*. That is the whole of
 * why the shared `Rank by` / lens row was dissolved.
 *
 * **`tight` is the manager card's one-row `lg` arm, and it is a prop rather
 * than an edit to the padding here because this component is read by two
 * tools.** The manager pane folds its control into its head row above `lg`, so
 * 11px of vertical padding around one 24px row reads as a ledge with a hole in
 * it; the lineup checker's ledge is still a track *over* a head row and wants
 * the breath it has. Changing the constant would move the checker's two panes
 * by 3px apiece for a change made to neither.
 *
 * **The two arms are two whole strings, never a base plus an override.**
 * `lg:py-1` beside `lg:pb-1.5 lg:pt-[5px]` is a shorthand against two longhands
 * of the same specificity, and Tailwind emits longhands *after* shorthands — so
 * the default would win at both ends whatever the ternary said, and the ledge
 * would silently keep its old height. It is the trap `CONSOLE_KEY_PILL_SHELL`
 * and `CONSOLE_CARD_SHELL` are split for, one property over.
 */
export function PaneLedge({
  children,
  tight = false,
}: {
  children: ReactNode;
  /** Above `lg`, 4px of padding for a ledge that is one row — see above. */
  tight?: boolean;
}) {
  return (
    <div
      className={`${CONSOLE_WINDOW_LEDGE} shrink-0 rounded-lg px-1.5 pb-[5px] pt-1 lg:px-[7px] ${
        tight ? "lg:py-1" : "lg:pb-1.5 lg:pt-[5px]"
      }`}
    >
      {children}
    </div>
  );
}

/** A ledge's own head type: stamped into the metal, not lit. */
export function PaneHead({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] lg:text-[length:var(--fs-12)] lg:tracking-[0.14em] ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * The glass a pane's rows are cut into.
 *
 * `CONSOLE_GLASS` rather than `CONSOLE_WINDOW`: a window's shadow closes its
 * recess against a bezel with a lit teal lip, and this sits under a ledge that
 * already separates it from the part around it — a second lit edge there is a
 * third place the card would spend teal, which is the count the console-card
 * pass fixed the tile row by holding to two.
 *
 * **It takes the pane's remaining height** (`min-h-0 flex-1`) and is where the
 * scroll happens — the caller says how, because the two panes scroll
 * differently: the standings glass is itself the scroller, and the roster's is
 * a fixed frame holding a scroller, a drawer and two pinned bars. What the
 * caller must not do is let it grow: without `min-h-0` here the pane's cap has
 * nothing to bite on and the whole expanded half grows with the longest list.
 */
export function PaneGlass({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`${CONSOLE_GLASS} mt-[3px] min-h-0 flex-1 rounded-lg lg:mt-1.5 lg:rounded-[0.625rem] ${className}`}
    >
      <Scanlines />
      {children}
    </div>
  );
}

/**
 * Which reading a pane's drawer is showing.
 *
 * Two names rather than one because the manager card's roster pane carries two
 * bars — the bench and the portfolio — and the lineup checker's lineup pane
 * carries the first alone. The heights below are keyed by it so both cards read
 * one spelling of the arithmetic.
 */
export type DrawerTray = "bench" | "picks";

/**
 * The two bars' own heights — **34px at `lg` and 30 below it for the bench
 * bar, 30 at both for the picks bar** — which are also what a drawer sits on.
 *
 * A drawer's `bottom` and its `max-height` are functions of the bars' sum, and
 * the sum follows the breakpoint, so it is written as a CSS custom property on
 * the drawer (`--bars`, in {@link DRAWER_BARS}) by a class per arm and the two
 * inline values read it back: the drawer sits on its bars at every width with
 * no measurement, and a `ResizeObserver` for two constants is the wrong tool.
 *
 * **Both records are spelled literally rather than templated off a number.**
 * Tailwind finds classes by scanning source text, and a class assembled from a
 * template literal is generated for nothing — driven, the bench bar rendered
 * 30px at `lg` because `lg:h-[34px]` did not exist in the stylesheet. So the
 * arithmetic is in this comment and the spelling is below, side by side: an
 * edit to a bar's height is an edit to its class *and* to every `--bars` arm
 * that sums it, or the drawer sits off its bars by the difference.
 */
export const DRAWER_BAR_HEIGHT: Record<DrawerTray, string> = {
  bench: "h-[30px] lg:h-[34px]",
  picks: "h-[30px] lg:h-[30px]",
};

/** The `--bars` sum per combination of bars present, in the order drawn. */
export const DRAWER_BARS: Record<string, string> = {
  bench: "[--bars:30px] lg:[--bars:34px]",
  picks: "[--bars:30px] lg:[--bars:30px]",
  "bench,picks": "[--bars:60px] lg:[--bars:64px]",
};

/**
 * The stock both bars are cut from.
 *
 * **The tracking goes below `lg` and the gutter tightens with it**, which is
 * the card's own rule about its tile labels one plane up and is a measurement
 * rather than a taste: a bar is ~160px at 390 and `BENCH · 7` at
 * `tracking-[0.12em]` needs 81 of the 80 it has, so it truncated to `BENCH ·…`
 * and lost the one number it is read for. Letter-spacing is the first thing to
 * spend, because the count is what the bar says and the place beside it is what
 * it says next.
 */
export const DRAWER_BAR =
  "lab-anim flex w-full cursor-pointer items-center gap-1.5 bg-[image:var(--billet-bg)] px-1.5 text-left " +
  "font-mono text-[length:var(--fs-11)] uppercase tracking-[0.02em] shadow-[var(--standing-strip-shadow)] " +
  "transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-active/60 " +
  "lg:gap-2.5 lg:px-3 lg:text-[length:var(--fs-12-5)] lg:tracking-[0.12em]";

/**
 * One bar pinned to the bottom of a pane's glass.
 *
 * **Billet stock over the glass, not another row of it.** The bar is a part
 * bolted across the list — that is what says the drawer behind it is a separate
 * reading rather than the list continuing — and it takes the standing strip's
 * own chamfer for it.
 *
 * A real `<button>`, where the design prototype draws a `role="button"` div: a
 * bar is a control and the platform already knows how to make one reachable,
 * announce its state and fire it from a keyboard. The caller owns the button —
 * this is its face — so `aria-expanded` is true only on the bar whose reading
 * is up, which is accurate: one drawer, and at most one of two bars has it
 * open.
 */
export function DrawerBar({
  open,
  label,
  children,
}: {
  open: boolean;
  /** What the bar is called, and what its count is: `Bench · 6`. */
  label: string;
  /** The readings between the label and the caret. */
  children?: ReactNode;
}) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
      {/* The caret turns rather than swapping glyph, which is what says the
          drawer rises out of this bar rather than appearing somewhere. It is
          `aria-hidden` because `aria-expanded` on the button already carries
          the state, and a bar whose name ended in "right-pointing triangle"
          would be read the long way round. */}
      <span
        aria-hidden
        className={`lab-anim w-4 shrink-0 text-right text-[length:var(--fs-12)] text-[color:var(--billet-label)] transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] lg:w-5 lg:text-[length:var(--fs-13)] ${
          open ? "rotate-90" : ""
        }`}
      >
        ▸
      </span>
    </>
  );
}

/**
 * The box a drawer's rows rise in, anchored to its bars.
 *
 * **Anchored at the bottom, so growing its `max-height` *is* the upward
 * accordion** — no measurement, and no transform that would blur the type under
 * it. The cap is the glass less the bars it sits on and a little of the list, so
 * a reader can always see what the drawer is rising over.
 *
 * **`max()` and not the bare `calc`**, which is what the design specifies and
 * what goes silently wrong on a short viewport: the panel's cap can leave a
 * glass shorter than the bars themselves, and a negative `max-height` clamps to
 * zero — a lit bar with a rotated caret that opens nothing. Floored, a cramped
 * drawer overflows upward instead and is clipped by the glass, which shows less
 * than it wants and never nothing.
 *
 * **Kept mounted while shut**, or it would have no closed state to animate
 * from, and `inert` is what keeps its rows out of the tab order while it is —
 * `pointer-events: none` stops a mouse and nothing else, which is
 * `CollapseTray`'s own finding one component over. The transition list is
 * spelled identically in both states for that file's other reason: rewriting
 * `transition` in the same frame as the animated property cancels it.
 *
 * **A flex column, and a caller's scroller inside it is `min-h-0 flex-1`.** The
 * drawer's own height comes from `max-height` over auto content, so a
 * percentage `max-height` on the child has nothing definite to resolve against
 * and computes to `none` — which is not a scroller that fails to scroll but a
 * scroller that is not one: the rows overflow and this box's `overflow-hidden`
 * clips them, so a deep bench loses its last few players with nothing on screen
 * saying so.
 */
export function PaneDrawer({
  id,
  open,
  bars,
  children,
}: {
  id: string;
  open: boolean;
  /** The `--bars` sum for the bars below it — see {@link DRAWER_BARS}. */
  bars: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      inert={!open}
      className={`lab-anim absolute inset-x-[3px] z-[2] flex flex-col overflow-hidden rounded-[0.625rem] bg-[image:var(--billet-bg)] shadow-[var(--billet-shadow),0_-22px_34px_-14px_rgba(0,0,0,0.9)] [transition:max-height_340ms_cubic-bezier(0.2,0.8,0.2,1),opacity_200ms_ease,padding_340ms_cubic-bezier(0.2,0.8,0.2,1)] ${bars}`}
      style={{
        bottom: "var(--bars)",
        maxHeight: open ? "max(5.75rem, calc(100% - var(--bars) - 14px))" : 0,
        padding: open ? 4 : 0,
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

/**
 * The recess on a pane's ledge, and what the pane reports about itself.
 *
 * The manager card's ledge carries this pane's *control*; a week pane has no
 * pane-scoped control, so the track carries the readings instead — the same
 * claim about ownership made with a different cargo: a figure on the ledge is
 * plainly *this list's* total, where the same figure on the card's own plate
 * would be the league's. The lineup checker's and the gametime page's, one
 * spelling.
 *
 * **The legend drops below `lg` and the figures step down with it.** Measured
 * at 390 a pane is ~165px, and a legend beside two labelled figures at the
 * design's own sizes is ~205 — so the legend goes (the pane's own name is on
 * the head row 4px below) and the figures take the size the rows under them
 * use.
 *
 * **The height is fixed rather than a floor**, which is what makes two panes
 * read across: a track sized to its content is 31.9px holding two totals and
 * 29.8px holding a key, so a pane whose ledge held something else put its rows
 * 2px out of step with the one opposite — invisible as anything but a slight
 * wrongness. 32px is also the card's own control recess above.
 *
 * **Below `lg` the track holds both totals, and the padding and gap are what
 * were spent to fit them.** Two labelled figures together are ~139px of a
 * ~141px content box at 390 once the track is `px-1.5` with no vertical
 * padding (the height is fixed, so that padding bought nothing), the gap
 * between them is 5px and each pair is set tight — see {@link PaneTotal}.
 * Right-aligned, so the figures sit on the same edge above and below `lg`,
 * where the `flex-1` spacer after the legend does the same job. The `lg` arm
 * is the legend, `p-[3px] pl-3`, the 10px gap.
 */
export function PaneLedgeTrack({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <div
      className={`${CONSOLE_PANE_TRACK} flex h-8 min-w-0 items-center justify-end gap-[5px] px-1.5 lg:h-[34px] lg:gap-2.5 lg:py-[3px] lg:pl-3 lg:pr-[3px]`}
    >
      <span
        aria-hidden
        className="hidden shrink-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] lg:inline"
      >
        {legend}
      </span>
      <span className="min-w-0 flex-1" />
      {children}
    </div>
  );
}

/**
 * One of a pane's totals, milled into the ledge.
 *
 * The figure sits in a `--recess-bg` cell under `--figure-well-shadow` — a hole
 * cut in *metal*, the same turning-over a drawer's own rows already make against
 * the glass's wells one surface down.
 *
 * Null draws an em dash rather than a zero, on the contract's own rule: a
 * figure is null where there is no answer, and a `0.0` there is a roster
 * scored at nothing.
 *
 * **Set tight below `lg`** — a 3px gap and `0.1em` of tracking on the label —
 * which is what two of these cost to sit in a phone's track together; see
 * {@link PaneLedgeTrack}. From `lg` up the pair keeps its 5px and `0.14em`.
 */
export function PaneTotal({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone?: "error" | "accent";
}) {
  const ink =
    tone === "error"
      ? "text-error"
      : tone === "accent"
        ? "text-[color:var(--billet-accent)]"
        : "text-[color:var(--billet-figure)]";
  return (
    <span className="inline-flex shrink-0 items-baseline gap-[3px] lg:gap-[5px]">
      <span className="font-mono text-[length:var(--fs-8)] uppercase tracking-[0.1em] text-[color:var(--billet-label)] lg:text-[length:var(--fs-9)] lg:tracking-[0.14em]">
        {label}
      </span>
      <span
        className={`rounded-[5px] bg-[color:var(--recess-bg)] px-1 py-0.5 font-mono text-[length:var(--fs-11)] tabular-nums shadow-[var(--figure-well-shadow)] lg:px-1.5 lg:text-[length:var(--fs-12-5)] ${ink}`}
      >
        {value === null ? "—" : value.toFixed(1)}
      </span>
    </span>
  );
}
