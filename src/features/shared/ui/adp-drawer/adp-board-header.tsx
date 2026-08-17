import type { AdpBoardType } from "@/shared/manager";

import type { LeagueFilters } from "../../league-filters";
import type { AdpSort, AdpSortColumn } from "../../adp-sort";
import {
  AUCTION_COLUMN_SEAT,
  BOARD_COLUMNS_BOTH,
  BOARD_COLUMNS_ONE,
  BOARD_NAMES,
  KTC_COLUMN_SEAT,
} from "./adp-drawer.constants.ts";
import {
  KTC_BOARD_NAMES,
  auctionTitle,
  boardTitle,
  ktcTitle,
  sortHeadingLabel,
  takenTitle,
  valueTitle,
} from "./adp-drawer.utils.ts";

/** The heading row's own type treatment, shared by both column configurations. */
const HEADING_ROW =
  "items-center gap-2 px-2 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/35";

/**
 * The board's sticky head: what the columns are, and — since every heading is a
 * control now — what the list is ordered on.
 *
 * Sticky, because the board is the one part of the drawer that scrolls and a
 * column of bare numbers three hundred rows down says nothing. It paints the
 * panel's own ground rather than a translucent one — the rows have to pass
 * *behind* it, not through it.
 *
 * **It used to lead with two board keys and doesn't now.** They toggled the
 * redraft and dynasty columns, which is a control offering to take away one of
 * two markets the board is already showing side by side — and the draft counts
 * they carried on their faces are on the ADP headings' own hover
 * ({@link boardTitle}), where they sit against the column they describe. What
 * still sets `boards` is seeding from a league, which picks the market that
 * league is in; the single-board branch below is what draws that.
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
  soleBoard,
  soleDrafts,
  soleAuctions,
  redraftDrafts,
  dynastyDrafts,
  rules,
  sort,
  refreshing = false,
  onSort,
}: {
  both: boolean;
  soleBoard: AdpBoardType;
  soleDrafts: number | null;
  /**
   * The auctions behind the Bid column — a *different* count from `soleDrafts`,
   * because it is a different population: the same leagues and window, over the
   * one draft type the board never averages.
   */
  soleAuctions: number | null;
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
      {/* The status lane is drawn only while it has something to say, where the
          board keys used to hold it open. That costs a small shift as a refresh
          starts, and it is paid at the one moment it costs nothing: `stale` is
          placeholder data, which only happens on a filter press, and a press is
          already sending the list back to the top. */}
      {refreshing && (
        // `role="status"` announces the refresh politely; the pulse is
        // decoration and steps aside under reduced motion, where the words
        // still carry the state.
        <div className="flex items-center px-2 pb-1.5">
          <span
            role="status"
            className="ml-auto text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-active/70 motion-safe:animate-pulse"
          >
            Updating…
          </span>
        </div>
      )}
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
          {/* `Bid` rather than `$` or `Auction`: the first is a glyph a reader
              has to guess the denominator of, the third does not fit a 36px
              track, and the second is what the column is a reading of. What it
              is a share *of* — and that these are drafts the ADP beside it is
              never averaged over — is the hover's job. */}
          {heading("auction", "Bid", "Average auction bid, as a share of budget", {
            title: auctionTitle(soleBoard, soleAuctions),
            className: AUCTION_COLUMN_SEAT,
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
