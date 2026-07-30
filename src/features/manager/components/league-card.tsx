"use client";

import { useEffect, useRef, useState } from "react";

import { formatRecord } from "../format";
import type { MetricContext } from "../league-metrics";
import type { LeagueKtcEntry, LeagueRankSet, ManagerLeague } from "../types";
import { LeagueDetailPanel } from "./league-detail-panel";
import { MetricColumn } from "./metric-column";
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
  /** The metric key each of the four stat columns shows, shared by every card. */
  columns: string[];
  /** Point a column at another metric (applies to every card at once). */
  onColumnChange: (slot: number, key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Which column's picker is open, if any — one at a time, so opening one closes
  // the last. Lifted here (not into each column) so the row can lift its stacking
  // order while a menu overhangs the card below it, and so an outside click has a
  // single thing to close.
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openSlot === null) return;
    const onDown = (event: MouseEvent) => {
      if (statsRef.current && !statsRef.current.contains(event.target as Node)) {
        setOpenSlot(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenSlot(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openSlot]);

  const record = league.record;
  const ctx: MetricContext = { league, ranks, ktc, weeks, valuedAt };

  return (
    <li
      className={`group relative rounded-xl border border-foreground/10 bg-gradient-to-b from-foreground/[0.06] to-foreground/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_28px_-16px_rgba(0,0,0,0.7)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_20px_44px_-18px_rgba(0,0,0,0.85)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        openSlot !== null ? "z-30" : ""
      }`}
    >
      <div className="flex w-full flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
        >
          <Chevron open={expanded} size="md" />
          <StatusDot status={league.status} />
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {league.name}
          </h3>
          {record && (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground/70">
              {formatRecord(record)}
            </span>
          )}
        </button>

        <div
          ref={statsRef}
          className="flex shrink-0 items-stretch divide-x divide-foreground/10"
        >
          {columns.map((key, slot) => (
            <MetricColumn
              key={slot}
              metricKey={key}
              ctx={ctx}
              open={openSlot === slot}
              onToggle={() =>
                setOpenSlot((current) => (current === slot ? null : slot))
              }
              onSelect={(metricKey) => {
                onColumnChange(slot, metricKey);
                setOpenSlot(null);
              }}
            />
          ))}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-foreground/10 py-4">
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
