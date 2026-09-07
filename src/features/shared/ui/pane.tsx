import type { ReactNode } from "react";

import {
  CONSOLE_BILLET,
  CONSOLE_GLASS,
  CONSOLE_MILLED_WELL,
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
 * reason `card-plate.tsx` exists one level up. {@link DrawerRow} is here for
 * exactly that reason a second time: the bench rows are the breakdown's and the
 * pick rows are `draft-picks.tsx`'s, and the breakdown imports that file.
 */

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
      className={`${CONSOLE_BILLET} @container relative flex min-h-0 min-w-0 flex-1 flex-col rounded-xl p-0.5 sm:rounded-[0.875rem] lg:p-2`}
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
 */
export function PaneLedge({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${CONSOLE_WINDOW_LEDGE} shrink-0 rounded-lg px-1.5 pb-1.5 pt-[5px] lg:px-2 lg:pb-2 lg:pt-[7px]`}
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
      className={`${CONSOLE_GLASS} mt-[3px] min-h-0 flex-1 rounded-lg lg:mt-2 lg:rounded-[0.625rem] ${className}`}
    >
      <Scanlines />
      {children}
    </div>
  );
}

/**
 * The shell every drawer row is cut from — bench and picks alike.
 *
 * **Billet stock, not the glass's own channel.** The drawer is a part bolted
 * over the starters rather than more of the same list, so its rows are cut into
 * that part; drawn in `CONSOLE_ROW_WELL` they would read as the starters
 * continuing under a bar, which is exactly the thing the drawer exists not to
 * be.
 *
 * **Two lines below `lg`, one above it**, which is not this row's own idea — it
 * is the seat rows' arrangement, at the seat rows' breakpoint, because a drawer
 * row is read directly over the seat row it covers and two rows of different
 * heights would not read across. A render is what forced it: at 390 a pane is
 * 168px, and three cells beside a name leave the bench's name **0px** and the
 * pick's **7px** — one character, which is the failure this file records at
 * three other grains.
 *
 * One node with two layouts through `lg:contents`, the trick the app rack's
 * brand row turns: the alternative renders every row twice and reads each of
 * them twice to anything listening.
 *
 * Both cells are `--recess-bg` rather than `--figure-well-bg`, which is the
 * same turning-over the wells one surface up already make — a hole cut in
 * *metal* is the metal's own shadow, where the glass's wells are cut in glass.
 */
export function DrawerRow({
  lead,
  /** The `lg` width of the leading cell: a position is three characters, a season is four. */
  leadWidth,
  figure,
  children,
}: {
  lead: string;
  leadWidth: string;
  figure: string;
  /** The row's subject — a face and a name, or a pick and where it came from. */
  children: ReactNode;
}) {
  return (
    <li
      className={`${CONSOLE_MILLED_WELL} relative mb-[5px] flex h-[66px] flex-col justify-center gap-2 rounded-lg px-[7px] lg:mb-1 lg:h-[46px] lg:flex-row lg:items-center lg:gap-2.5 lg:rounded-[9px] lg:px-3`}
    >
      <span className="relative flex w-full min-w-0 items-center gap-[7px] lg:contents">
        {children}
      </span>
      <span className="relative flex w-full items-center gap-2 lg:contents">
        <span
          className={`shrink-0 overflow-hidden rounded-md bg-[color:var(--recess-bg)] px-[5px] py-1 text-center font-mono text-[length:var(--fs-12)] tabular-nums text-[color:var(--billet-label)] shadow-[var(--figure-well-shadow)] lg:order-1 ${leadWidth}`}
        >
          {lead}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden rounded-md bg-[color:var(--recess-bg)] px-[5px] py-1 text-right font-mono text-[length:var(--fs-13)] tabular-nums text-[color:var(--billet-name)] shadow-[var(--figure-well-shadow)] lg:order-4 lg:w-[74px] lg:flex-none">
          {figure}
        </span>
      </span>
    </li>
  );
}
