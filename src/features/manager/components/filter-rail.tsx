"use client";

import { useMemo } from "react";

import type { ManagerLeague } from "@/shared/contract";
import { type LeagueFilters, matchesFilters } from "@/features/shared";

/**
 * One fixed filter: a label and a row of option chips, each carrying what
 * picking it would leave.
 *
 * **The counts are a cross-tab, not a tally.** `probe` closes over the whole
 * draft and substitutes one field, so each number says what *this* selection
 * with that option would leave — the question the dialog is opened to answer.
 * Lighting Dynasty therefore moves the Format row's numbers underneath it,
 * which a per-filter-in-isolation count could not show.
 *
 * Generic over the option value so the two rails keep their own unions: a
 * `LeagueFilters["type"]` cannot be handed to the Format row by mistake.
 */
export function FilterRail<T extends string>({
  label,
  options,
  value,
  leagues,
  probe,
  onPick,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  /** The unfiltered list the counts are taken over. */
  leagues: readonly ManagerLeague[];
  /** The draft with this row's field set to the option under the cursor. */
  probe: (value: T) => LeagueFilters;
  onPick: (value: T) => void;
}) {
  const counts = useMemo(
    () =>
      options.map(
        (option) =>
          leagues.filter((league) => matchesFilters(league, probe(option.value)))
            .length,
      ),
    [options, leagues, probe],
  );

  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-1"
    >
      <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {options.map((option, i) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(option.value)}
              className={`inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50 ${
                selected
                  ? "border-active/40 bg-active/15 text-active"
                  : "border-foreground/12 bg-foreground/[0.04] text-foreground/70 hover:bg-foreground/[0.08] hover:text-foreground"
              }`}
            >
              {option.label}
              {/* The lit chip's count takes the accent at *full* opacity and
                  is held apart by size alone: light mode's teal is only ~5:1
                  against the page, so an alpha on it drops below AA — the rule
                  the account heading is written to as well. */}
              <span
                className={`text-[10px] tabular-nums ${
                  selected ? "text-active" : "text-foreground/40"
                }`}
              >
                {counts[i]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
