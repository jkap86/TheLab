"use client";

import { useState } from "react";

import type { ShareMetric, ShareMetricContext } from "../share-metrics";
import type { ManagerLeague } from "../types";
import { MetricColumns } from "./metric-column";
import { Chevron, SharedLeagueRow } from "./ui";

/**
 * One share in the players or leaguemates list: the same glassy card a league
 * wears, with the player or person where the league name goes and the leagues
 * behind the share where the standings panel goes.
 *
 * These two views were a dense table of a count and a percentage — which answers
 * how much exposure and nothing about its shape — while the leagues beside them
 * had four pickable stat columns. They are cards for that reason: the columns are
 * the point, and a row 28 pixels tall has nowhere to put them. Which metric each
 * slot holds is {@link ShareList}'s, so the columns line up down the page.
 *
 * The name and chevron are the expand target and the stat columns are their own
 * pickers, exactly as on a league card — clicking a column opens its menu rather
 * than the card.
 */
export function ShareCard({
  name,
  icon,
  note,
  leagues,
  metrics,
  ctx,
  columns,
  onColumnChange,
}: {
  name: string;
  /** Leads the name: a position pill, an avatar — whatever identifies the row. */
  icon: React.ReactNode;
  /** A dim trailing detail on the name — the NFL team on a player, nothing on a person. */
  note?: string | null;
  /** The leagues behind this share, listed when the card is expanded. */
  leagues: ManagerLeague[];
  /** The catalogue this card's columns pick from — players get the ADP metrics. */
  metrics: ShareMetric[];
  ctx: ShareMetricContext;
  columns: string[];
  onColumnChange: (slot: number, key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Whether one of the stat columns has its picker open — see the same note on
  // {@link LeagueCard}: the columns own which, the card owns the stacking order.
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li
      className={`group relative rounded-xl border border-foreground/10 bg-gradient-to-b from-foreground/[0.06] to-foreground/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_28px_-16px_rgba(0,0,0,0.7)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_20px_44px_-18px_rgba(0,0,0,0.85)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        menuOpen ? "z-30" : ""
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
          {icon}
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {name}
          </h3>
          {note && (
            <span className="shrink-0 text-xs tabular-nums text-foreground/40">
              {note}
            </span>
          )}
        </button>

        <MetricColumns
          metrics={metrics}
          ctx={ctx}
          columns={columns}
          onColumnChange={onColumnChange}
          onOpenChange={setMenuOpen}
        />
      </div>

      {expanded && (
        <ul className="border-t border-foreground/10 px-4 py-3">
          {leagues.map((league) => (
            <SharedLeagueRow key={league.league_id} league={league} />
          ))}
        </ul>
      )}
    </li>
  );
}
