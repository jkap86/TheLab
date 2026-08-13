import type { AdpBoardType } from "@/shared/manager";

import type { LeagueFilters } from "../../league-filters";
import type { AdpSort, AdpSortColumn } from "../../adp-sort";
import {
  BOARD_COLUMNS_BOTH,
  BOARD_COLUMNS_ONE,
  BOARD_NAMES,
  KTC_COLUMN_SEAT,
} from "./adp-drawer.constants.ts";
import {
  KTC_BOARD_NAMES,
  boardTitle,
  ktcTitle,
  sortHeadingLabel,
  takenTitle,
  valueTitle,
} from "./adp-drawer.utils.ts";
import { KeyChip } from "./key-chip";

/** The heading row's own type treatment, shared by both column configurations. */
const HEADING_ROW =
  "items-center gap-2 px-2 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/35";

/**
 * The board's sticky head: which markets are drawn, what the columns under them
 * are, and — since every heading is a control now — what the list is ordered on.
 *
 * Sticky, because the board is the one part of the drawer that scrolls and a
 * column of bare numbers three hundred rows down says nothing. It paints the
 * panel's own ground rather than a translucent one — the rows have to pass
 * *behind* it, not through it. The board keys ride in it rather than in the
 * pinned block above: they choose what the *list* shows, so they sit with the
 * columns they toggle — and each carries its own board's draft count, which is
 * the population a reader needs to weigh a column at all.
 *
 * **Every heading sorts, which is what turned this row from a caption into a
 * bank of controls.** Two consequences worth keeping. The columns are a step
 * wider than they were — a heading carrying a direction caret needs room the
 * same label lying flat did not — and the arithmetic for that is written out in
 * {@link BOARD_COLUMNS_ONE}. And the position column, which used to be a
 * deliberate blank, is named: a control a reader cannot read is a control they
 * cannot press, and grouping the board by position is one of the more useful
 * things this list can be asked for.
 */
export function AdpBoardHeader({
  both,
  shown,
  soleBoard,
  soleDrafts,
  redraftDrafts,
  dynastyDrafts,
  rules,
  sort,
  refreshing = false,
  onToggleBoard,
  onSort,
}: {
  both: boolean;
  shown: Record<AdpBoardType, boolean>;
  soleBoard: AdpBoardType;
  soleDrafts: number | null;
  redraftDrafts: number | null;
  dynastyDrafts: number | null;
  /** The board's league rules — the value headings' premise reads its size. */
  rules: LeagueFilters;
  /**
   * The order the list is in — already resolved against what this mode draws,
   * so a heading here can never be lit for a column that isn't on screen.
   */
  sort: AdpSort;
  /**
   * The rows under this head belong to a previous filter set still on screen
   * while the new board loads. Said here, in the one part of the list that
   * never scrolls away and is always at the top the filter press just reset
   * the scroll to — the dimmed rows say something is off, this says what.
   */
  refreshing?: boolean;
  onToggleBoard: (board: AdpBoardType) => void;
  /** A heading was pressed; the reducer deciding what that means is `nextAdpSort`. */
  onSort: (column: AdpSortColumn) => void;
}) {
  const heading = (
    column: AdpSortColumn,
    label: string,
    name: string,
    extra?: { title?: string; className?: string; align?: "left" | "right" },
  ) => (
    <SortHeading
      column={column}
      label={label}
      name={name}
      sort={sort}
      onSort={onSort}
      title={extra?.title}
      className={extra?.className}
      align={extra?.align ?? "right"}
    />
  );

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-1.5 bg-[rgb(12,23,33)] pt-0.5">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <span className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-foreground/40">
          Boards
        </span>
        <BoardKey
          board="redraft"
          on={shown.redraft}
          drafts={redraftDrafts}
          onToggle={onToggleBoard}
        />
        <BoardKey
          board="dynasty"
          on={shown.dynasty}
          drafts={dynastyDrafts}
          onToggle={onToggleBoard}
        />
        {refreshing && (
          // `role="status"` announces the refresh politely; the pulse is
          // decoration and steps aside under reduced motion, where the words
          // still carry the state.
          <span
            role="status"
            className="ml-auto text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-active/70 motion-safe:animate-pulse"
          >
            Updating…
          </span>
        )}
      </div>
      {both ? (
        <div className={`grid ${BOARD_COLUMNS_BOTH} ${HEADING_ROW}`}>
          {heading("rank", "#", "Board order")}
          {heading("name", "Player", "Player name", { align: "left" })}
          {heading("position", "Pos", "Position", { align: "left" })}
          {heading("adp_redraft", "ADP R", "Redraft ADP", {
            title: boardTitle("redraft", redraftDrafts),
          })}
          {heading("adp_dynasty", "ADP D", "Dynasty ADP", {
            title: boardTitle("dynasty", dynastyDrafts),
          })}
          {heading("value_redraft", "Val R", "Redraft draft capital", {
            title: valueTitle(rules),
            className: "hidden @md:block",
          })}
          {heading("value_dynasty", "Val D", "Dynasty draft capital", {
            title: valueTitle(rules),
            className: "hidden @md:block",
          })}
          {ktcHeadings(heading)}
        </div>
      ) : (
        <div className={`grid ${BOARD_COLUMNS_ONE} ${HEADING_ROW}`}>
          {heading("rank", "#", "Board order")}
          {heading("name", "Player", "Player name", { align: "left" })}
          {heading("position", "Pos", "Position", { align: "left" })}
          {heading(`adp_${soleBoard}`, "ADP", `${BOARD_NAMES[soleBoard]} ADP`, {
            title: boardTitle(soleBoard, soleDrafts),
          })}
          {/* "Taken" is a share, and the header is the only place to say of
              what — a column reading 46% next to an ADP of 3.2 is otherwise
              a number nobody can name. */}
          {heading("taken", "Taken", "Share of drafts taken in", {
            title: takenTitle(soleBoard),
          })}
          {heading(`value_${soleBoard}`, "Value", "Draft capital", {
            title: valueTitle(rules),
          })}
          {ktcHeadings(heading)}
        </div>
      )}
    </div>
  );
}

/**
 * The KTC pair, identical in both column configurations.
 *
 * Written once rather than in each branch because they are the one part of this
 * row that does *not* vary with the boards on screen: KTC's two boards are
 * superflex and 1QB, which is a different axis from redraft and dynasty, so the
 * same two columns are correct whichever markets are lit. Two branches spelling
 * them separately would be two chances for the seat or the heading to drift, and
 * a heading seated a tier apart from its column is a label over the wrong
 * numbers.
 */
function ktcHeadings(
  heading: (
    column: AdpSortColumn,
    label: string,
    name: string,
    extra?: { title?: string; className?: string; align?: "left" | "right" },
  ) => React.ReactNode,
) {
  return (
    <>
      {heading(
        "ktc_sf",
        KTC_BOARD_NAMES.sf,
        "KeepTradeCut superflex dynasty value",
        { title: ktcTitle("sf"), className: KTC_COLUMN_SEAT },
      )}
      {heading(
        "ktc_oneqb",
        KTC_BOARD_NAMES.oneqb,
        "KeepTradeCut 1QB dynasty value",
        { title: ktcTitle("oneqb"), className: KTC_COLUMN_SEAT },
      )}
    </>
  );
}

/**
 * One column's heading, which is a button.
 *
 * **A control that looks like content is one nobody presses**, which is the
 * app-bar grammar this row now has to keep: the hover lights the heading's own
 * box rather than only its text, so the part reads as pressable before it is
 * pressed. It stops short of the milled `.lab-ledge-slot` the manager list's
 * headings wear, and deliberately — that treatment is a channel cut into a lit
 * billet, and there is no billet here to cut into; drawn on this panel's flat
 * ground it would read as a blemish rather than as machining.
 *
 * The lit column takes the accent, because "this is the column the list is in"
 * is exactly the kind of state the accent means everywhere else in this app. The
 * caret is `aria-hidden` decoration — {@link sortHeadingLabel} is what actually
 * says the direction — and it is a size down from the label so it reads as a
 * mark on the heading rather than as a character of it.
 */
function SortHeading({
  column,
  label,
  name,
  sort,
  onSort,
  title,
  className = "",
  align,
}: {
  column: AdpSortColumn;
  /** What the column is called, at the width the column has. */
  label: string;
  /** What it is called where there is room to say it properly — the a11y name. */
  name: string;
  sort: AdpSort;
  onSort: (column: AdpSortColumn) => void;
  title?: string;
  /** The column's seat, where it has one — the same string its cells wear. */
  className?: string;
  align: "left" | "right";
}) {
  const active = sort.column === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      title={title}
      aria-label={sortHeadingLabel(name, active ? sort.direction : null)}
      className={`${className} w-full truncate rounded-sm transition-colors ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-active" : "hover:text-foreground/70"}`}
    >
      {label}
      {active && (
        <span aria-hidden className="ml-0.5 text-[0.5rem]">
          {sort.direction === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

/**
 * One board's key: whether that market's columns are drawn, with its own draft
 * count on the face — different for the two boards by construction. Toggling the
 * only lit board off is a no-op (`toggleAdpBoard`), so the list can never go
 * blank.
 */
function BoardKey({
  board,
  on,
  drafts,
  onToggle,
}: {
  board: AdpBoardType;
  on: boolean;
  drafts: number | null;
  onToggle: (board: AdpBoardType) => void;
}) {
  return (
    <KeyChip small on={on} onClick={() => onToggle(board)}>
      {BOARD_NAMES[board]}
      {drafts !== null && (
        <span className="ml-1 text-[0.55rem] tabular-nums opacity-70">
          {drafts.toLocaleString()}
        </span>
      )}
    </KeyChip>
  );
}
