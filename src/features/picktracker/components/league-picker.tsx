"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { ManagerLeague } from "@/shared/manager";

/**
 * A searchable, keyboard-navigable league picker for the pick tracker's landing
 * page.
 *
 * A native `<select>` can't be filtered and an account here can hold 100+
 * leagues, so this is a combobox: type to narrow the list by name, arrow keys to
 * move the highlight, Enter or click to pick. Picking navigates (via `onSelect`),
 * so there is no persistent selected value to keep — the input is purely the
 * search box, and its text is the query.
 *
 * Themed with the app's `foreground`/`active` tokens (and `--background` for the
 * opaque overlay) rather than left to the browser, which is the whole reason for
 * building it over the native control.
 */
export function LeaguePicker({
  leagues,
  loading,
  onSelect,
}: {
  leagues: ManagerLeague[];
  loading: boolean;
  onSelect: (leagueId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? leagues.filter((l) => l.name.toLowerCase().includes(q)) : leagues;
  }, [leagues, query]);

  // Close when a pointer goes down outside — robust where a blur handler isn't,
  // since clicking an option blurs the input before its click can register.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted option in view as the arrows move past the fold.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const disabled = loading || leagues.length === 0;
  const placeholder = loading
    ? "Loading your leagues…"
    : leagues.length === 0
      ? "No leagues found"
      : "Search your leagues…";

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const league = filtered[activeIndex];
      if (league) onSelect(league.league_id);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-label="Search your leagues"
        aria-expanded={open}
        // The listbox is mounted with the popup, so the reference is only true
        // while it is open — a combobox that permanently points at a missing id
        // is a broken relationship rather than a closed one.
        aria-controls={open && !disabled ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          open && filtered[activeIndex] ? optionId(activeIndex) : undefined
        }
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-foreground/15 bg-foreground/[0.03] px-4 py-2.5 pr-9 text-base text-foreground placeholder:text-foreground/35 focus:border-active/50 focus:outline-none focus:ring-1 focus:ring-active/40 disabled:cursor-not-allowed disabled:text-foreground/35"
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 transition-transform ${
          open ? "rotate-180" : ""
        }`}
      >
        ▾
      </span>

      {open && !disabled && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          style={{ backgroundColor: "var(--background)" }}
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-lg border border-foreground/15 py-1 shadow-lg shadow-black/40"
        >
          {filtered.length === 0 ? (
            // `presentation`, because a `listbox` may only own `option`s — an
            // empty-state row announced as a selectable league is worse than
            // one announced as nothing at all.
            <li role="presentation" className="px-4 py-2 text-sm text-foreground/45">
              No leagues match “{query.trim()}”
            </li>
          ) : (
            filtered.map((league, index) => (
              <li
                key={league.league_id}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(league.league_id)}
                className={`cursor-pointer truncate px-4 py-2 text-sm ${
                  index === activeIndex
                    ? "bg-active/15 text-foreground"
                    : "text-foreground/80"
                }`}
              >
                {league.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
