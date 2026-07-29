"use client";

import { useState } from "react";

import { formatRecord } from "../format";
import type { PlayerShare } from "../shares";
import type { ManagerLeague } from "../types";
import { PositionBadge } from "./ui";

/**
 * The grid a share row and the heading above it share — one template for both,
 * so the headings stay over their numbers.
 *
 * Written out whole so Tailwind sees the class string.
 */
const COLUMNS =
  "grid-cols-[1rem_minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[1rem_minmax(0,1fr)_4.5rem_4rem]";

/**
 * Every player the manager rosters, most-owned first, each expanding to the
 * leagues that hold him.
 *
 * One line per row rather than the two the league panel uses: this list has a
 * full page to work with, so the name is in no danger of losing its space.
 *
 * Both numbers are shown because neither is the whole answer. The count is what
 * the manager actually holds and is comparable between players; the share is
 * what it means for a portfolio, and it moves when the filters do — eight
 * leagues is heavy exposure across ten and barely a position across a hundred.
 */
export function PlayerShares({
  shares,
  leagueCount,
}: {
  shares: PlayerShare[];
  /** Leagues the shares are out of — see `PlayerShares.league_count`. */
  leagueCount: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-foreground/10">
      <div
        className={`grid ${COLUMNS} items-center gap-x-2 border-b border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-[0.65rem] uppercase tracking-wide text-foreground/40 sm:text-xs`}
      >
        <span />
        <span className="truncate">Player</span>
        <span className="text-right">Leagues</span>
        <span className="text-right">Share</span>
      </div>
      <ul className="divide-y divide-foreground/5">
        {shares.map((share) => (
          <ShareRow
            key={share.player_id}
            share={share}
            leagueCount={leagueCount}
          />
        ))}
      </ul>
    </div>
  );
}

function ShareRow({
  share,
  leagueCount,
}: {
  share: PlayerShare;
  leagueCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const held = share.leagues.length;
  const pct = leagueCount > 0 ? Math.round((held / leagueCount) * 100) : 0;

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
          <PositionBadge position={share.position} />
          <span className="min-w-0 truncate text-sm text-foreground/90">
            {share.name}
          </span>
          {share.team && (
            <span className="shrink-0 text-[0.65rem] tabular-nums text-foreground/35">
              {share.team}
            </span>
          )}
        </span>

        <span className="text-right text-sm tabular-nums text-foreground/80">
          {held}
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
          {share.leagues.map((league) => (
            <LeagueRow key={league.league_id} league={league} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** One league holding the player, named and sized. */
function LeagueRow({ league }: { league: ManagerLeague }) {
  // A record only says something once a game has been played. In the offseason
  // every one of these is 0-0, which is a column of nothing on every row of
  // every player — the same reason the roster panel doesn't asterisk byes.
  //
  // Resolved to a string here rather than tested in the JSX, where a falsy
  // `0` would render itself.
  const record = league.record;
  const played =
    record && (record.wins || record.losses || record.ties)
      ? formatRecord(record)
      : null;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1 pl-6">
      <span className="min-w-0 truncate text-sm text-foreground/70">
        {league.name}
      </span>
      <span className="shrink-0 text-[0.7rem] tabular-nums text-foreground/40">
        {played && <>{played} · </>}
        {league.total_rosters} teams
      </span>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 text-foreground/30 transition-transform ${
        open ? "rotate-90" : ""
      }`}
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
