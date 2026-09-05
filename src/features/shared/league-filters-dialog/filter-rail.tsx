"use client";

import { useMemo } from "react";

import type { ManagerLeague } from "@/shared/contract";
import { type LeagueFilters, matchesFilters } from "../league-filters";

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
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2 py-1.5"
    >
      <span className="w-13 shrink-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-foreground/45">
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
              // Every chip is a key — raised, and it travels when pressed.
              // What picking one changes is its border and its legend, not
              // whether it is a key: they are one row of the same control.
              className={`inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border bg-[image:var(--key-bg)] px-[0.6875rem] py-[0.3125rem] font-mono text-[length:var(--fs-11)] shadow-[var(--key-shadow)] transition-[transform,box-shadow,color] duration-150 active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
                selected
                  ? "border-active/45 text-readout [text-shadow:var(--readout-text-glow)]"
                  : "border-foreground/10 text-foreground/70 hover:text-readout"
              }`}
            >
              {option.label}
              {/* The lit chip's count takes the readout colour at *full*
                  opacity and is held apart by size alone: light mode's teal is
                  only ~5:1 against the page, so an alpha on it drops below AA
                  — the rule the account heading is written to as well. (The
                  handoff spells this one at 75%; the rule wins, since it is
                  the same colour and the same failure.) */}
              <span
                className={`font-mono text-[length:var(--fs-10)] tabular-nums ${
                  selected ? "text-readout" : "text-foreground/45"
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
