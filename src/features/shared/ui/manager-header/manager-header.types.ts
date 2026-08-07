import type { ReactNode } from "react";

import type {
  LeaguesProgressMessage,
  LeaguesResultMessage,
  UserInfo,
} from "@/shared/contract";

import type { OverallRecord } from "../../record";

/**
 * A `progress` message from the leagues stream, as the state line reads it.
 *
 * Aliased from the contract here rather than taken from the manager feature's
 * `types.ts`, which is where it was read from while this card lived in that
 * tool. A shared component reaching into a feature is the import the mover's
 * rule exists to prevent, and the shape was never that tool's to begin with —
 * it is what the route sends.
 */
export type HeaderProgress = LeaguesProgressMessage;

/** The leagues stream's own summary of a completed sync. */
export type HeaderSyncSummary = LeaguesResultMessage["summary"];

/** A view's own headline count, shown as the plate's top-right corner tab. */
export type HeaderStat = {
  label: string;
  value: ReactNode;
  /** The dim second line — usually what the count is out of. */
  sub?: ReactNode;
};

/**
 * What a page hands the header.
 *
 * The three `/manager/[searched]/…` views vary in only `stat` and `columns`,
 * which is why this is one card taking props rather than three copies
 * — see {@link ManagerHeader}. The lineup checker is the fourth page to wear it
 * and varies in one thing more: it has no leagues stream behind it, which is why
 * the three sync fields are optional rather than three nulls threaded through a
 * page that has nothing to report.
 */
export type ManagerHeaderProps = {
  user: UserInfo;
  season: string;
  /**
   * The leagues stream's state, where the page is reading one. All three are
   * optional together: a page with no background refresh to report passes none,
   * and the transient state line is simply never drawn (see `hasSyncState`).
   */
  refreshing?: boolean;
  progress?: HeaderProgress | null;
  summary?: HeaderSyncSummary;
  /**
   * A refresh that failed after cached data was already served. Shown as a
   * pill rather than replacing the page: what's below is stale, not wrong.
   */
  refreshError?: string | null;
  /**
   * The manager's season summed over the leagues on screen — or, on the lineup
   * checker, the record this week's lineups are *projected* to leave them with.
   * One shape, because the plate draws it the same way either way and the two
   * rules behind it ({@link aggregateRecord}) are the same rules.
   */
  record: OverallRecord;
  /**
   * What the record was counted over, in words, or null where there is nothing
   * to say. A modal hides its own state, so the manager tabs' selection is still
   * repeated outside it — but only when there *is* one: "counting all leagues"
   * is the default describing itself, and it sat on this card permanently for
   * the sake of the rare case. Where it says something it says it beside the
   * record, which is the number it qualifies — which is also why the lineup
   * checker names its *week* here rather than in a line of its own.
   */
  scope: string | null;
  /**
   * How many leagues the record is out of — what `record.leagues` is measured
   * against. It is stated only where the two differ, since the usual case
   * ("116 of 116") is a denominator restating its own numerator.
   */
  leagueCount: number;
  /** The view's own headline count, worn as the plate's top-right corner tab. */
  stat: HeaderStat;
  /**
   * Whether the readout may give its slot to the kickoff countdown while there
   * is one to run. It normally may — the argument is on {@link HeaderReadout} —
   * and it rests on a claim about the *record* beside it: before kickoff every
   * league reports `0-0`, so the dial is an em dash by rule and the clock is the
   * only moving number on the card.
   *
   * That claim is the manager tabs', not the card's. The lineup checker's record
   * is the week ahead as it currently stands, and Sleeper publishes those
   * projections months out — so its dial reads a real number all offseason, and
   * the clock was covering the one figure that page exists to produce. A page
   * whose record is live before kickoff passes false and keeps the dial.
   *
   * It is a prop rather than something the readout works out for itself because
   * nothing in the header can see the difference: both records arrive as the same
   * {@link OverallRecord}, and only the page knows which question it counted.
   */
  countdown?: boolean;
  /**
   * The list's stat-column headings, laid on the cards' geometry.
   *
   * It rides in the header rather than at the top of the list for one reason:
   * this card is pinned, so anything inside it is pinned too, and a heading rail
   * that scrolls away halfway down a hundred-row list leaves the numbers under it
   * unlabelled. Sitting here it needs no offset of its own — measuring this
   * card's height to pin a sibling beneath it is the machinery not writing it
   * here avoids. (That measurement does exist now, in
   * {@link usePinnedHeight}, and the exception is narrow: it is for a *row of the
   * list* that pins under this card, which cannot ride inside it. Anything that
   * belongs with the card still comes here.) It is outside the plate because it
   * belongs to neither: it is
   * the list's own header, and it is laid out to line up with the rows rather
   * than with anything on this card.
   */
  columns?: ReactNode;
  /**
   * Whether the card's opaque paint fades out below itself rather than ending.
   * It normally does — the argument is on {@link ManagerHeader} — and it costs
   * nothing, because what is under those 64px is the page's own background with
   * the list scrolling through it.
   *
   * A page lowers it while a row below has pinned an *opaque* surface flush
   * against this card: an expanded league card does exactly that, and there the
   * fade has nothing to blend into and 64px of near-solid background lands on the
   * card's own head — washing out the league's name and the stat columns at the
   * top of the one thing being read. So it is drawn against the page and dropped
   * against a part.
   *
   * It is a prop rather than something this card works out because the card can
   * see nothing below itself; only the page knows whether one of its rows has
   * taken the screen. It replaced a `pinned` prop that answered the same question
   * for a bigger consequence — the card used to let go of the top entirely while
   * a league was open, which took both filter rows and the heading rail off
   * screen with it.
   */
  fade?: boolean;
};
