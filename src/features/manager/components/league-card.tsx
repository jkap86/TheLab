"use client";

import { useState } from "react";

import type { ManagerLeague } from "../types";
import { LeagueDetailPanel } from "./league-detail-panel";

export function LeagueCard({ league }: { league: ManagerLeague }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.02] transition-colors hover:border-white/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 rounded-xl p-4 text-left hover:bg-white/[0.02]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Chevron open={expanded} />
            <h3 className="truncate text-lg font-semibold">{league.name}</h3>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-6">
            {league.record && (
              <span className="rounded-md bg-white/5 px-2 py-0.5 text-sm font-medium tabular-nums text-white/80">
                {league.record.wins}-{league.record.losses}-
                {league.record.ties}
              </span>
            )}
            <Stat value={league.total_rosters} label="teams" />
          </div>
        </div>
        <StatusBadge status={league.status} />
      </button>

      {expanded && (
        <div className="border-t border-white/10 py-4">
          <LeagueDetailPanel leagueId={league.league_id} />
        </div>
      )}
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="rounded-md bg-white/5 px-2 py-0.5 text-sm text-white/55">
      <span className="font-semibold tabular-nums text-white/85">
        {value.toLocaleString()}
      </span>{" "}
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "in_season"
      ? "border-active/40 text-active"
      : status === "drafting" || status === "pre_draft"
        ? "border-amber-400/40 text-amber-300"
        : "border-white/15 text-white/45";
  return (
    <span
      className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide ${tone}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
