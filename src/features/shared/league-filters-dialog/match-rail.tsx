"use client";

import type { ManagerLeague } from "@/shared/contract";
import { CONSOLE_READOUT, CONSOLE_WELL } from "../console-chrome";
import {
  type ActiveFilter,
  activeFilters,
  clearFilter,
  type LeagueFilters,
  leagueBreakdown,
} from "../league-filters";

/**
 * What the draft leaves, and what it is made of.
 *
 * Three readings, in the order the question is asked: how many leagues survive,
 * which filters are doing it (each removable), and what the survivors actually
 * *are* along the axes that say what game is being played. The chips are the
 * only place in the dialog a filter can be undone without going back to the
 * control that set it, which is what makes an over-narrowed selection
 * recoverable in one press.
 */
export function MatchRail({
  matched,
  total,
  filters,
  onChange,
}: {
  /** The survivors themselves — the breakdown counts over them. */
  matched: readonly ManagerLeague[];
  total: number;
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
}) {
  const active = activeFilters(filters);
  // 0 of 0 is not 0%: an account with no leagues has no share to report.
  const share = total > 0 ? matched.length / total : null;
  const rows = leagueBreakdown(matched);

  return (
    <div
      role="group"
      aria-label="Matching leagues"
      className={`${CONSOLE_WELL} flex flex-col gap-4 p-3.5`}
    >
      <div role="status" className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/45">
          Leagues matching
        </span>
        {/* The one figure on the panel that is an *answer* rather than a
            control, so it is the one on lit glass. */}
        <span
          className={`${CONSOLE_READOUT} flex items-baseline gap-2 rounded-[0.625rem] px-3 py-2.5`}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
          />
          <span className="relative font-mono text-[1.75rem] leading-none tabular-nums text-readout [text-shadow:var(--readout-text-glow)] sm:text-4xl">
            {matched.length}
          </span>
          <span className="relative font-mono text-[0.6875rem] text-readout/60">
            of {total}
            {share !== null && ` · ${Math.round(share * 100)}%`}
          </span>
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.9)]">
        <div
          className="h-full rounded-full bg-active shadow-[0_0_10px_var(--accent-glow)] transition-[width] duration-200"
          style={{ width: `${(share ?? 0) * 100}%` }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/45">
          Narrowing
        </span>
        {active.length === 0 ? (
          <p className="m-0 font-mono text-[0.6875rem] text-foreground/45">
            Nothing yet — every league is in.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {active.map((entry) => (
              <ActiveChip
                key={chipKey(entry)}
                entry={entry}
                onRemove={() => onChange(clearFilter(filters, entry))}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/45">
          Of these {matched.length}
        </span>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-0.5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between">
              <dt className="truncate font-mono text-[0.6875rem] text-foreground/60">
                {row.label}
              </dt>
              <dd className="m-0 shrink-0 font-mono text-[0.6875rem] tabular-nums text-foreground/82">
                {row.count}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Stable across a re-render: a rule's address is its kind and its position. */
function chipKey(entry: ActiveFilter): string {
  return entry.kind === "fixed"
    ? `fixed:${entry.field}`
    : `${entry.kind}:${entry.index}`;
}

function ActiveChip({
  entry,
  onRemove,
}: {
  entry: ActiveFilter;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[0.4375rem] border border-active/28 bg-active/10 py-[0.1875rem] pl-2 pr-[0.3125rem] font-mono text-[0.6875rem] text-foreground/88">
      {entry.label}
      <button
        type="button"
        aria-label={`Stop filtering by ${entry.label}`}
        onClick={onRemove}
        className="leading-none text-foreground/45 transition-colors hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
      >
        ×
      </button>
    </span>
  );
}
