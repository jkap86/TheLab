"use client";

import { useState } from "react";

import {
  LIST_ROW_HOVER,
  LIST_ROW_SURFACE,
  RowSheen,
} from "@/features/shared";

import { formatRecord } from "../format";
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
 * The four stat columns across it are each a slot the reader points at a metric —
 * where this manager stands by record, by points, by KTC starter value and by
 * projected points to start with, but swappable to the raw number behind a rank
 * or to KTC bench value from the label's picker. Which metric each slot shows is
 * held above this card, in {@link ManagerLeagues}, so every card shows the same
 * four and the columns line up column to column down the whole list.
 *
 * The name and chevron are the expand target; the stat columns are their own
 * pickers, so the card is no longer one button — clicking a column opens its
 * menu rather than the panel.
 */
export function LeagueCard({
  league,
  ranks,
  weeks,
  ktc,
  valuedAt,
  adp,
  columns,
  onColumnChange,
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
  /** Point a column at another metric (applies to every card at once). */
  onColumnChange: (slot: number, key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Whether one of the stat columns has its picker open — the columns own which,
  // but the row is what has to lift its stacking order while a menu overhangs the
  // card below it.
  const [menuOpen, setMenuOpen] = useState(false);

  const record = league.record;
  const ctx: MetricContext = { league, ranks, ktc, adp, weeks, valuedAt };

  return (
    <li
      className={`${LIST_ROW_SURFACE} ${LIST_ROW_HOVER} ${
        menuOpen ? "z-30" : ""
      }`}
    >
      <RowSheen />

      {/* `relative` is what keeps the sheen behind this rather than over it — an
          absolutely positioned sibling paints above static content whatever the
          source order. */}
      <div className="relative flex w-full flex-col items-stretch gap-3 px-4 py-3 pl-5 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
        >
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
        </button>

        <MetricColumns
          metrics={LEAGUE_METRICS}
          ctx={ctx}
          columns={columns}
          onColumnChange={onColumnChange}
          onOpenChange={setMenuOpen}
        />
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
