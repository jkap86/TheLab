import type { ReactNode } from "react";

import {
  CONSOLE_BILLET,
  CONSOLE_GLASS,
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
 * reason `card-plate.tsx` exists one level up.
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
 * `@container` is what sizes the team marks inside it: `Avatar size="sm"` grows
 * with the *panel* rather than the viewport, which is the right axis here — a
 * pane on a wide card has room for a 24px mark and the same pane on a phone
 * does not, whatever the window around it is doing.
 */
export function Pane({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${CONSOLE_BILLET} @container relative min-w-0 flex-1 rounded-xl p-0.5 sm:rounded-[0.875rem] lg:p-2`}
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
      className={`${CONSOLE_WINDOW_LEDGE} rounded-lg px-1.5 pb-1.5 pt-[5px] lg:px-2 lg:pb-2 lg:pt-[7px]`}
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
      className={`${CONSOLE_GLASS} mt-[3px] rounded-lg lg:mt-2 lg:rounded-[0.625rem] ${className}`}
    >
      <Scanlines />
      {children}
    </div>
  );
}
