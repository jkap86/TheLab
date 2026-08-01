"use client";

import { useState } from "react";

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
 */
export function LeagueCard({
  league,
  ranks,
  weeks,
  ktc,
  valuedAt,
  adp,
  columns,
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
}) {
  const [expanded, setExpanded] = useState(false);

  const record = league.record;
  const standing = ranks?.standing ?? null;
  const ctx: MetricContext = { league, ranks, ktc, adp, weeks, valuedAt };

  return (
    <li className={`${LIST_ROW_SURFACE} ${LIST_ROW_HOVER}`}>
      <RowSheen />

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
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // Space scrolls the page otherwise, which is what a native button
          // suppresses for us.
          event.preventDefault();
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        className="relative flex w-full cursor-pointer flex-col items-stretch gap-3 px-4 py-3 pl-5 text-left sm:flex-row sm:items-center sm:gap-4"
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

      {expanded && (
        <div className="relative border-t border-foreground/10 py-4">
          <LeagueDetailPanel leagueId={league.league_id} />
        </div>
      )}
    </li>
  );
}

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
