"use client";

import type { ManagerLeague } from "../types";

export type LeagueFilters = {
  /** Sleeper `settings.type`: "all" or a stringified 0=redraft, 1=keeper, 2=dynasty. */
  type: "all" | "0" | "1" | "2";
  /** Sleeper `settings.best_ball`: "all", or filter by best-ball on/off. */
  bestBall: "all" | "yes" | "no";
};

export const DEFAULT_LEAGUE_FILTERS: LeagueFilters = {
  type: "all",
  bestBall: "all",
};

/** Read a numeric field out of a league's Sleeper `settings` blob. */
function settingNumber(league: ManagerLeague, key: string): number | undefined {
  const value = league.settings?.[key];
  return typeof value === "number" ? value : undefined;
}

/** Whether a league passes the active filters. */
export function matchesFilters(
  league: ManagerLeague,
  filters: LeagueFilters,
): boolean {
  if (filters.type !== "all") {
    // Sleeper omits `type` for standard redraft leagues; treat missing as 0.
    if ((settingNumber(league, "type") ?? 0) !== Number(filters.type)) {
      return false;
    }
  }
  if (filters.bestBall !== "all") {
    const isBestBall = settingNumber(league, "best_ball") === 1;
    if (filters.bestBall === "yes" ? !isBestBall : isBestBall) return false;
  }
  return true;
}

const TYPE_OPTIONS: { value: LeagueFilters["type"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "0", label: "Redraft" },
  { value: "1", label: "Keeper" },
  { value: "2", label: "Dynasty" },
];

const BEST_BALL_OPTIONS: { value: LeagueFilters["bestBall"]; label: string }[] =
  [
    { value: "all", label: "All" },
    { value: "yes", label: "Best ball" },
    { value: "no", label: "Lineup" },
  ];

export function LeaguesFilters({
  filters,
  onChange,
}: {
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <FilterGroup label="Type">
        {TYPE_OPTIONS.map((opt) => (
          <SegmentButton
            key={opt.value}
            active={filters.type === opt.value}
            onClick={() => onChange({ ...filters, type: opt.value })}
          >
            {opt.label}
          </SegmentButton>
        ))}
      </FilterGroup>

      <FilterGroup label="Format">
        {BEST_BALL_OPTIONS.map((opt) => (
          <SegmentButton
            key={opt.value}
            active={filters.bestBall === opt.value}
            onClick={() => onChange({ ...filters, bestBall: opt.value })}
          >
            {opt.label}
          </SegmentButton>
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-white/40">
        {label}
      </span>
      <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5">
        {children}
      </div>
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
        active ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}
