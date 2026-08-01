"use client";

import { useId, useMemo, useState } from "react";

import type { TradeOption } from "../filters";

/**
 * One multi-select filter list: a search box over the options, checkboxes for
 * what's selected, and the count of trades behind each.
 *
 * A list rather than a combobox like the pick tracker's league picker, because
 * this filter takes *several* values and shows what is already chosen — a
 * combobox picks one thing and closes. Selected options are hoisted to the top
 * and always shown, so a selection made under one search term doesn't vanish
 * when the term changes and leave the count on the trigger unexplained.
 *
 * The count beside each option is what makes the list worth reading rather than
 * just searching: it says which of your leaguemates actually deal, and which
 * player has moved more than once, before you narrow to them.
 */
export function OptionPicker({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: readonly TradeOption[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const inputId = useId();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const chosen = new Set(selected);
    const matches = options.filter(
      (o) => chosen.has(o.value) || !q || o.label.toLowerCase().includes(q),
    );
    // Selected first, then the ordering `tradeOptions` produced (busiest first).
    return [
      ...matches.filter((o) => chosen.has(o.value)),
      ...matches.filter((o) => !chosen.has(o.value)),
    ];
  }, [options, query, selected]);

  const toggle = (value: string) =>
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <label
          htmlFor={inputId}
          className="text-xs font-bold uppercase tracking-[0.16em] text-foreground/40"
        >
          {label}
        </label>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="ml-auto text-xs font-semibold text-foreground/45 transition-colors hover:text-foreground"
          >
            Clear {selected.length}
          </button>
        )}
      </div>

      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-foreground/30 focus:border-active/45"
      />

      <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto pr-1">
        {shown.length === 0 && (
          <li className="px-1 py-2 text-sm text-foreground/40">
            {options.length === 0 ? "Nothing to filter on" : "No matches"}
          </li>
        )}
        {shown.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <li key={option.value}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(option.value)}
                className={`flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-active/10 text-foreground"
                    : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 shrink-0 self-center rounded-[4px] border ${
                    isSelected
                      ? "border-active bg-active"
                      : "border-foreground/25"
                  }`}
                />
                <span className="min-w-0 truncate">{option.label}</span>
                {option.note && (
                  <span className="shrink-0 text-xs text-foreground/40">
                    {option.note}
                  </span>
                )}
                <span
                  className={`ml-auto shrink-0 font-mono text-[11px] tabular-nums ${
                    isSelected ? "text-active" : "text-foreground/30"
                  }`}
                >
                  {option.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
