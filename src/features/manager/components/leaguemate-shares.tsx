"use client";

import { useState } from "react";

import { Avatar } from "@/features/shared";

import type { LeaguemateShare } from "../leaguemates";
import { Chevron, SharedLeagueRow } from "./ui";

/**
 * The grid a leaguemate row and the heading above it share — one template for
 * both, so the headings stay over their numbers.
 *
 * Written out whole so Tailwind sees the class string.
 */
const COLUMNS =
  "grid-cols-[1rem_minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[1rem_minmax(0,1fr)_4.5rem_4rem]";

/**
 * Everyone the manager shares a league with, most-shared first, each expanding
 * to the leagues they share.
 *
 * The player-shares list with a person where the player goes: same one-line
 * rows, same count-and-share columns, same expansion. Labelled by username, per
 * the standings rule — a team name is a nickname someone picked for one league,
 * and this list exists to recognise the same person *across* leagues.
 */
export function LeaguemateShares({
  mates,
  leagueCount,
}: {
  mates: LeaguemateShare[];
  /** Leagues the shares are out of — see `LeaguemateShares.league_count`. */
  leagueCount: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-foreground/10">
      <div
        className={`grid ${COLUMNS} items-center gap-x-2 border-b border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-[0.65rem] uppercase tracking-wide text-foreground/40 sm:text-xs`}
      >
        <span />
        <span className="truncate">Manager</span>
        <span className="text-right">Leagues</span>
        <span className="text-right">Share</span>
      </div>
      <ul className="divide-y divide-foreground/5">
        {mates.map((mate) => (
          <MateRow key={mate.user_id} mate={mate} leagueCount={leagueCount} />
        ))}
      </ul>
    </div>
  );
}

function MateRow({
  mate,
  leagueCount,
}: {
  mate: LeaguemateShare;
  leagueCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shared = mate.leagues.length;
  const pct = leagueCount > 0 ? Math.round((shared / leagueCount) * 100) : 0;

  return (
    <li className={expanded ? "bg-foreground/[0.02]" : undefined}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`grid w-full ${COLUMNS} items-center gap-x-2 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.04]`}
      >
        <Chevron open={expanded} />

        <span className="flex min-w-0 items-center gap-2">
          <Avatar url={mate.avatar_url} name={mate.name} size="sm" />
          <span className="min-w-0 truncate text-sm text-foreground/90">
            {mate.name}
          </span>
        </span>

        <span className="text-right text-sm tabular-nums text-foreground/80">
          {shared}
          <span className="text-foreground/30"> / {leagueCount}</span>
        </span>
        {/* Dimmer than the count: it is that number restated against the
            filtered league set, not a second thing to compare. */}
        <span className="text-right text-sm tabular-nums text-foreground/40">
          {pct}%
        </span>
      </button>

      {expanded && (
        <ul className="border-t border-foreground/5 px-3 pb-2 pt-1">
          {mate.leagues.map((league) => (
            <SharedLeagueRow key={league.league_id} league={league} />
          ))}
        </ul>
      )}
    </li>
  );
}
