import type { ReactNode } from "react";

import type { OverallRecord } from "../../record";
import type { LeaguesResult, SyncProgress } from "../../types";

/** A view's own headline count, shown as the plate's top-right corner tab. */
export type HeaderStat = {
  label: string;
  value: ReactNode;
  /** The dim second line — usually what the count is out of. */
  sub?: ReactNode;
};

/**
 * What the three `/manager/[searched]/…` views hand the header.
 *
 * Only `stat`, `filters` and `columns` differ between them, which is why this is
 * one card taking props rather than three copies — see {@link ManagerHeader}.
 */
export type ManagerHeaderProps = {
  user: LeaguesResult["user"];
  season: string;
  refreshing: boolean;
  progress: SyncProgress | null;
  summary: LeaguesResult["summary"];
  /**
   * A refresh that failed after cached data was already served. Shown as a
   * pill rather than replacing the page: what's below is stale, not wrong.
   */
  refreshError?: string | null;
  /** The manager's season summed over the leagues the filters leave. */
  record: OverallRecord;
  /**
   * Those filters in words, or null where they narrow nothing. A modal hides its
   * own state, so the selection is still repeated outside it — but only when
   * there *is* one: "counting all leagues" is the default describing itself, and
   * it sat on this card permanently for the sake of the rare case. Where it says
   * something it says it beside the record, which is the number it qualifies.
   */
  scope: string | null;
  /**
   * How many leagues the filters leave — what `record.leagues` is out of. It is
   * stated only where the two differ, since the usual case ("116 of 116") is a
   * denominator restating its own numerator.
   */
  leagueCount: number;
  /** The view's own headline count, worn as the plate's top-right corner tab. */
  stat: HeaderStat;
  /**
   * The filters' trigger, seated in the plate's bottom-right corner. Omitted
   * where a view has nothing to filter (e.g. a manager with no leagues) — which
   * is also what returns the bottom padding holding the key clear of the dial,
   * so an unfilterable header is exactly as tall as its contents.
   */
  filters?: ReactNode;
  /**
   * The list's stat-column headings, laid on the cards' geometry.
   *
   * It rides in the header rather than at the top of the list for one reason:
   * this card is pinned, so anything inside it is pinned too, and a heading rail
   * that scrolls away halfway down a hundred-row list leaves the numbers under it
   * unlabelled. Sitting here it needs no offset of its own — measuring this
   * card's height to pin a sibling beneath it is the machinery not writing it
   * here avoids. It is outside the dock and outside the plate because it belongs
   * to neither: it is the list's own header, and it is laid out to line up with
   * the rows rather than with anything on this card.
   */
  columns?: ReactNode;
  /**
   * Whether the card holds the top of the screen. It normally does — that is the
   * whole argument on {@link ManagerHeader} — and the leagues tab lowers it while
   * a league is expanded: an open panel is capped at the viewport and given the
   * screen, so a card pinned over it would be spending a quarter of the one thing
   * being read on facts about the account. Unpinning is a change of `position`
   * and nothing else, because a sticky element occupies its normal flow space
   * either way, so the plate stays exactly where it is and simply stops following
   * the scroll.
   */
  pinned?: boolean;
};
