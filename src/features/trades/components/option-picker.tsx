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
 *
 * **The list is capped at {@link MAX_SHOWN} rendered rows**, which it did not
 * need to be when the options were counted off whatever the browser held and does
 * now that they are counted off the whole season: a busy one moves a few thousand
 * distinct players, and every one of them was a button in the DOM behind a
 * 176px-tall scroller. The cap is applied *after* the search and after the
 * selected rows are hoisted, so nothing becomes unreachable — the way to a player
 * past the two hundredth busiest is to type his name, which is what the search
 * box is for and what anyone was going to do anyway.
 */
/** How many rows are rendered at once — see the note above. */
const MAX_SHOWN = 200;

export function OptionPicker({
  label,
  options,
  selected,
  onChange,
  placeholder,
  loading = false,
}: {
  label: string;
  options: readonly TradeOption[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  placeholder: string;
  /** True while the counts behind these options are being fetched. */
  loading?: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputId = useId();

  // A `Set` rather than `selected.includes` per option: this is read once per
  // option in the filter *and* once per rendered row, and the list is now the
  // season's whole vocabulary rather than a page of it.
  const chosen = useMemo(() => new Set(selected), [selected]);

  const { shown, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    // One pass into two buckets rather than three passes with two intermediate
    // arrays — the selected rows are hoisted, so the partition is the sort.
    const picked: TradeOption[] = [];
    const rest: TradeOption[] = [];
    for (const option of options) {
      if (chosen.has(option.value)) picked.push(option);
      else if (!q || option.label.toLowerCase().includes(q)) rest.push(option);
    }
    const matched = picked.length + rest.length;
    return {
      // Selected first, then the ordering the facets produced (busiest first).
      shown: picked.concat(rest.slice(0, Math.max(0, MAX_SHOWN - picked.length))),
      hidden: Math.max(0, matched - MAX_SHOWN),
    };
  }, [options, query, chosen]);

  const toggle = (value: string) =>
    onChange(
      chosen.has(value)
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
            {loading
              ? "Counting…"
              : options.length === 0
                ? "Nothing to filter on"
                : "No matches"}
          </li>
        )}
        {shown.map((option) => {
          const isSelected = chosen.has(option.value);
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
                  {/* Nothing visible names this column — the count is what makes
                      the list worth reading, and read aloud it was a digit
                      trailing a player's name. */}
                  <span className="sr-only"> trades</span>
                </span>
              </button>
            </li>
          );
        })}
        {hidden > 0 && (
          // Said rather than left to be discovered: a truncated list that
          // doesn't say so reads as a player simply not having been traded.
          <li className="px-2 py-1.5 text-xs text-foreground/35">
            {hidden.toLocaleString()} more — search to narrow
          </li>
        )}
      </ul>
    </div>
  );
}
