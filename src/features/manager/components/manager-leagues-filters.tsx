"use client";

import type { LeagueFilters } from "../filters";

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
    // The second zone of the manager header card: a hairline below the identity
    // row, aligned to its left padding so the labels sit under the avatar.
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-foreground/10 py-3 pl-6 pr-5">
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
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/40">
        {label}
      </span>
      <div className="flex items-center gap-1 rounded-lg bg-foreground/5 p-0.5">
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
        active ? "bg-foreground/10 text-foreground" : "text-foreground/50 hover:text-foreground/80"
      }`}
    >
      {children}
    </button>
  );
}
