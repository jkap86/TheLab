"use client";

import { useEffect, useRef } from "react";

import {
  LIST_ROW_HOVER,
  LIST_ROW_SURFACE,
  RowSheen,
} from "@/features/shared";

import { formatRecord, ordinal } from "../format";
import { LEAGUE_METRICS, type MetricContext } from "../league-metrics";
import type {
  LeagueAdpEntry,
  LeagueKtcEntry,
  LeagueRankSet,
  ManagerLeague,
} from "../types";
import { LeagueDetailPanel } from "./league-detail-panel";
import { MetricColumns } from "./metric-column";
import { Chevron } from "./ui";

/**
 * One league in the leagues list: a dense, glassy row that reads at a glance and
 * opens the full standings-and-rosters panel on click.
 *
 * The record line names where this manager stands in the league — the one ranking
 * the card states outright, because it is what the record beside it means.
 *
 * The four stat columns across it are each a slot the reader points at a metric —
 * where this manager stands by points, by KTC starter value and by projected
 * points to start with, but swappable to the raw number behind a rank or to KTC
 * bench value. Which metric each slot shows is held above this card, in
 * {@link ManagerLeagues}, so every card shows the same four and the columns line
 * up column to column down the whole list — and the control that moves them is
 * the heading rail up there too, which is why this card renders numbers and no
 * pickers of its own.
 *
 * **An expanded card does not *hold* the detail panel, it *becomes* it.** The
 * row wore the list's glass while the panel inside it was a machined plate, so
 * one league was two materials nested four surfaces deep — glass, plate, trough,
 * row — before a player name was drawn, with the plate's own inset sitting
 * inside the card's and both coming out of the one track that has nowhere else
 * to go (the name). So expanding swaps this row's surface for `.lab-plate` and
 * the panel renders straight onto that face: one instrument, one inset, and the
 * app bar's grammar at card scale — the raised part is the one being worked in,
 * which is also why the rail lights and the hover lift goes away (a several-
 * hundred-pixel panel that rises under the pointer is a card pretending to still
 * be a row).
 *
 * **An open card takes the screen, which is why it doesn't hold its own open
 * state.** Expanding pulls the card up under the app bar, unpins the manager
 * plate above it (see {@link ManagerHeader}) and caps the panel at the viewport
 * so the detail scrolls inside the card rather than running off the bottom of a
 * page several screens long. Every one of those is a claim only one card can
 * make at a time, so which league is open is held in {@link ManagerLeagues} and
 * arrives here as a prop.
 */
export function LeagueCard({
  league,
  ranks,
  weeks,
  ktc,
  valuedAt,
  adp,
  columns,
  expanded,
  onToggle,
}: {
  league: ManagerLeague;
  /**
   * Where this manager sits by record, points for and projected points — null
   * while the ranks are loading, and each field independently null for a ranking
   * this league can't form yet (nothing projected, or nothing played). A missing
   * rank shows as a dim placeholder rather than a gap, so the columns stay put.
   */
  ranks: LeagueRankSet | null;
  /** The horizon behind the projected rank, so its hover can say what it covers. */
  weeks: number[];
  /**
   * This manager's KTC value here and its starter-value rank — null while
   * loading, and for a league they hold no roster in. Absent rather than zeroed,
   * on the same terms as `ranks`.
   */
  ktc: LeagueKtcEntry | null;
  /** When those KTC values were scraped, for the KTC metrics' hover. */
  valuedAt: string | null;
  /**
   * This manager's ADP-derived value here and its starter-value rank — null while
   * loading and for a league they hold no roster in, absent rather than zeroed on
   * the same terms as `ktc`.
   */
  adp: LeagueAdpEntry | null;
  /** The metric key each of the four stat columns shows, shared by every card. */
  columns: string[];
  /** Whether this is the league currently open — one at a time, list-wide. */
  expanded: boolean;
  /** Open this league, or close it if it is the one already open. */
  onToggle: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);

  // Opening pulls the card to the top of the screen, because that is what makes
  // the cap below a whole panel rather than the top of one: a card opened
  // halfway down the viewport would have half a screen to draw a panel that is
  // sized for a screen. The offset is `scroll-mt`, so the browser does the
  // arithmetic against the app bar rather than this reading a height at runtime.
  //
  // Closing scrolls nothing. The reader is looking at the card they just closed,
  // and moving the page under them to reverse a scroll they didn't ask for is
  // how a list loses its place.
  useEffect(() => {
    if (!expanded) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({
      block: "start",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [expanded]);

  const record = league.record;
  const standing = ranks?.standing ?? null;
  const ctx: MetricContext = { league, ranks, ktc, adp, weeks, valuedAt };

  return (
    <li
      ref={ref}
      className={
        expanded
          ? `${OPEN_SURFACE} ${OPEN_BOX}`
          : `${LIST_ROW_SURFACE} ${LIST_ROW_HOVER}`
      }
    >
      <RowSheen lit={expanded} />

      {/* The whole row is the toggle, not just the name half. The stat columns
          have nothing to press of their own — the pickers live in the heading
          rail above the list — so the right half of every card was inert while
          looking exactly as pressable as the left, and a click there did
          nothing.

          It is a `role="button"` div rather than a `<button>` because the row
          holds the metric columns, which are divs: flow content inside a button
          is invalid, and this is the way to make the whole row one press target
          without either rewriting a shared component's markup or dropping the
          league name's heading. The keyboard half is therefore hand-written —
          Enter and Space, the two keys a native button answers.

          `relative` is what keeps the sheen behind this rather than over it — an
          absolutely positioned sibling paints above static content whatever the
          source order. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // Space scrolls the page otherwise, which is what a native button
          // suppresses for us.
          event.preventDefault();
          onToggle();
        }}
        aria-expanded={expanded}
        // `shrink-0` because the open card is a flex column with a ceiling: the
        // head is the one part of it that must not be compressed to make room,
        // since the league's name is what says which panel this is.
        className="relative flex w-full shrink-0 cursor-pointer flex-col items-stretch gap-3 px-4 py-3 pl-5 text-left sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Chevron open={expanded} size="md" />
          <StatusDot status={league.status} />
          {/* The display face, as on a tool card — Orbitron is wider than the
              body face, so the size drops a step to keep a long league name from
              truncating any sooner than it did. */}
          <h3 className="min-w-0 flex-1 truncate font-display text-sm font-semibold tracking-tight">
            {league.name}
          </h3>
          {record && (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground/70">
              {formatRecord(record)}
            </span>
          )}
          {/* The standing rides with the record rather than occupying one of the
              four stat slots: it is what the record *means* in its league, so
              reading it anywhere else is reading half the fact. That is why it
              is no longer in the metric catalogue — a slot pointed at it would
              be a second copy of what this line already says. Absent, not
              zeroed, before a game is played, the same rule the rank cells
              keep. */}
          {standing && (
            <span
              title={`#${standing.rank} of ${standing.of} by record`}
              className="shrink-0 text-xs font-medium tabular-nums text-foreground/45"
            >
              {ordinal(standing.rank)}
              <span className="text-foreground/30"> of {standing.of}</span>
            </span>
          )}
        </div>

        {/* Numbers only, at every width: the heading rail pinned above the list
            names these columns and is the only thing that moves them, because
            the same four words repeated down a hundred rows is what made a
            list-wide selection read as a per-card one. */}
        <MetricColumns metrics={LEAGUE_METRICS} ctx={ctx} columns={columns} />
      </div>

      {/* No seam and no inset of its own: the panel is on this card's face, so
          what used to be a border between two surfaces would now be a line drawn
          across one. The padding under it belongs to the panel, which is where
          the container query that sizes it can see a width.

          This is the box that scrolls. It takes no `flex-1`: a flex item's
          default is `0 1 auto`, so a short panel — a league still loading, or a
          shallow one — is exactly as tall as its contents, and only one that
          would run past the card's ceiling shrinks into it and scrolls. `flex-1`
          would stretch every open card to the full screen whatever it had to
          say. `min-h-0` is what lets that shrink happen at all, since a flex
          item's floor is its content size otherwise.

          The radius is repeated here because a scroll container clips: without
          it the last roster row paints square across the card's rounded bottom
          corners. `overscroll-contain` keeps a flick at the end of the panel
          from carrying on into the page behind it — the card is the thing being
          read, and scroll chaining out of it is the list moving under a reader
          who was pulling on a roster. */}
      {expanded && (
        <div className="relative min-h-0 overflow-y-auto overscroll-contain rounded-b-xl">
          <LeagueDetailPanel leagueId={league.league_id} />
        </div>
      )}
    </li>
  );
}

/**
 * The surface an expanded card wears: the detail panel's own plate, at row
 * width. The border is the one part not in `.lab-plate` — the class carries
 * material and never a box — and it takes the accent rather than the list's
 * hairline, since a lit edge is what says which league is open when the card
 * above it is scrolled past.
 */
const OPEN_SURFACE = "lab-plate group relative rounded-xl border border-active/25";

/**
 * The box an expanded card lives in: a column with a ceiling, so the head stays
 * put and the panel scrolls inside it.
 *
 * The ceiling is the screen less the app bar and a hair of clearance, which is
 * the whole point — the panel is several hundred rows in a league with a deep
 * bench, and left to run it pushed its own card's head off the top of the
 * screen and the rest of the list several screens down. Capped, one open league
 * is one screen: the name and the stat columns above, the standings and rosters
 * under them, and the next league still where it was when the card is closed.
 *
 * `svh` and not `vh` or `dvh`: this must not extend past the bottom of the
 * screen on a phone, so the unit to size against is the viewport *with* the
 * browser's own chrome showing. `dvh` would grow and shrink the card as that
 * chrome hides, which on a scrolling panel reads as the page fighting the
 * finger.
 *
 * `scroll-mt` is the offset the open-scroll uses; it belongs on the element
 * being scrolled to, which is why it is here rather than in the effect.
 */
const OPEN_BOX =
  "flex max-h-[calc(100svh-var(--site-header-h)-1.5rem)] flex-col " +
  "scroll-mt-[var(--site-header-h)]";

/**
 * A small state dot standing in for the old text badge: the accent for a league
 * in season, amber for one still drafting, dim for anything done. The status
 * word rides on hover and for screen readers.
 */
function StatusDot({ status }: { status: string }) {
  const tone =
    status === "in_season"
      ? "bg-active shadow-[0_0_8px_rgba(0,255,229,0.7)]"
      : status === "drafting" || status === "pre_draft"
        ? "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.6)]"
        : "bg-foreground/30";
  return (
    <span title={status.replace(/_/g, " ")} className="flex shrink-0 items-center">
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
      <span className="sr-only">{status.replace(/_/g, " ")}</span>
    </span>
  );
}
