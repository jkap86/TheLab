"use client";

import { useId, useState } from "react";

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
 *
 * **`onSelect` splits that one target in two, and only the sheet passes it.** In
 * the shares sheet a row is something you *pick* — it narrows the league list
 * behind the glass — so the press a reader spends nine times out of ten has to be
 * the pick, and the expansion moves onto the chevron, which is the mark that
 * already means "there is more under this". On the tabs, where there is nothing
 * to pick, the row stays one button and the chevron stays inside it: two
 * behaviours would be worth avoiding, but a card that quietly did nothing on the
 * press its own mark advertises would be worse.
 */
export function ShareCard({
  name,
  icon,
  note,
  leagues,
  metrics,
  ctx,
  columns,
  selected = false,
  onSelect,
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
  /** Whether this row is one of the subjects narrowing the league list. */
  selected?: boolean;
  /** Toggle that selection. Omitted where the list is read rather than picked. */
  onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = () => setExpanded((v) => !v);
  // What `aria-expanded` is about — see `LeagueCard`, which names its panel for
  // the same reason.
  const panelId = useId();

  return (
    <li
      className={`${LIST_ROW_SURFACE} ${LIST_ROW_HOVER} ${
        // A picked row is lit rather than merely ticked: it is the thing the
        // list behind the sheet is currently being narrowed by, and the accent
        // is what this app already spends on a control that is doing something.
        // The glow replaces the surface's own drop shadow rather than joining it
        // — one `box-shadow` wins — so the inset top highlight is restated here.
        selected
          ? "border-active/55 bg-active/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_28px_-12px_rgba(0,255,229,0.8)]"
          : ""
      }`}
    >
      <RowSheen lit={selected} />

      <div className="relative flex w-full flex-col items-stretch gap-3 px-4 py-3 pl-5 sm:flex-row sm:items-center sm:gap-4">
        {/* The name half is one box whether it holds one button or two, so the
            chevron stays beside the name when the card stacks below `sm` rather
            than taking a line of its own above it. */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {onSelect && (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              aria-label={`Show the leagues holding ${name}`}
              className="-my-1 -ml-1 shrink-0 rounded-lg p-1 transition-colors hover:bg-foreground/5"
            >
              <Chevron open={expanded} size="md" />
            </button>
          )}
          <button
            type="button"
            onClick={onSelect ?? toggleExpanded}
            {...(onSelect
              ? { "aria-pressed": selected }
              : {
                  "aria-expanded": expanded,
                  "aria-controls": expanded ? panelId : undefined,
                })}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
          >
            {!onSelect && <Chevron open={expanded} size="md" />}
            {icon}
            {/* The display face and the size step down with it, exactly as on a
                league card — the two lists are the same row wearing a different
                subject, and a player's name reading larger than a league's would
                say otherwise. */}
            {/* `h2` for the reason a league card's name is one: the manager
                plate's title is the page's only `h1`, so a 3 here skipped 2. */}
            <h2 className="min-w-0 flex-1 truncate font-display text-sm font-semibold tracking-tight">
              {name}
            </h2>
            {note && (
              <span className="shrink-0 text-xs tabular-nums text-foreground/40">
                {note}
              </span>
            )}
          </button>
        </div>

        {/* Numbers only, for the reason a league card carries none either: the
            pinned heading rail names these columns at every width, and repeating
            them on every row is what made a list-wide selection read as a
            per-row one. */}
        <MetricColumns metrics={metrics} ctx={ctx} columns={columns} />
      </div>

      {expanded && (
        <ul id={panelId} className="relative border-t border-foreground/10 px-4 py-3">
          {leagues.map((league) => (
            <SharedLeagueRow key={league.league_id} league={league} />
          ))}
        </ul>
      )}
    </li>
  );
}
