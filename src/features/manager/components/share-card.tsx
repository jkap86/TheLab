"use client";

import { useState } from "react";

import {
  LIST_ROW_HOVER,
  LIST_ROW_SURFACE,
  RowSheen,
} from "@/features/shared";

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
 * The whole row is the expand target and the stat columns are numbers, exactly as
 * on a league card — the pickers that aim them live in the heading rail above the
 * list, since the selection is the list's.
 */
export function ShareCard({
  name,
  icon,
  note,
  leagues,
  metrics,
  ctx,
  columns,
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
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className={`${LIST_ROW_SURFACE} ${LIST_ROW_HOVER}`}>
      <RowSheen />

      <div className="relative flex w-full flex-col items-stretch gap-3 px-4 py-3 pl-5 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
        >
          <Chevron open={expanded} size="md" />
          {icon}
          {/* The display face and the size step down with it, exactly as on a
              league card — the two lists are the same row wearing a different
              subject, and a player's name reading larger than a league's would
              say otherwise. */}
          <h3 className="min-w-0 flex-1 truncate font-display text-sm font-semibold tracking-tight">
            {name}
          </h3>
          {note && (
            <span className="shrink-0 text-xs tabular-nums text-foreground/40">
              {note}
            </span>
          )}
        </button>

        {/* Numbers only, for the reason a league card carries none either: the
            pinned heading rail names these columns at every width, and repeating
            them on every row is what made a list-wide selection read as a
            per-row one. */}
        <MetricColumns metrics={metrics} ctx={ctx} columns={columns} />
      </div>

      {expanded && (
        <ul className="relative border-t border-foreground/10 px-4 py-3">
          {leagues.map((league) => (
            <SharedLeagueRow key={league.league_id} league={league} />
          ))}
        </ul>
      )}
    </li>
  );
}
