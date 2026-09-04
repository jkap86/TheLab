"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { CONSOLE_WELL } from "@/features/shared";
import type { ManagerLeague } from "@/shared/contract";

/**
 * A searchable, keyboard-navigable league picker.
 *
 * A native `<select>` cannot be filtered and an account here holds a hundred-odd
 * leagues, so this is a combobox: type to narrow by name, arrows to move the
 * highlight, Enter or click to pick. Picking navigates, so there is no
 * persistent selected value — the input is purely the search box and its text
 * is the query.
 *
 * **Four things here are fixes against the control this is ported from**, whose
 * own design notes list them as known and unfixed:
 *
 * - **Tab closes it.** Leaving the field with the popup still painted over the
 *   content below is the bug you only see with a keyboard.
 * - **The first ArrowDown out of a shut popup opens at 0 rather than 1.** Opening
 *   and advancing in one keystroke skips the first league every time, which is
 *   exactly the one a filtered list was narrowed down to.
 * - **Enter only picks while the popup is open.** After Escape the highlight
 *   survives, so the old control would pick out of a list nobody could see.
 * - **Option ids are keyed by `league_id`, not by position.** Positional ids
 *   rename row four on every keystroke as far as an assistive technology is
 *   concerned, where what actually happened is that the list was replaced.
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
  // Keyed by the league, not by where it happens to sit in a filtered list.
  const optionId = (leagueId: string) => `${baseId}-option-${leagueId}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? leagues.filter((l) => l.name.toLowerCase().includes(q)) : leagues;
  }, [leagues, query]);

  // Close when a pointer goes down outside — robust where a blur handler is
  // not, since clicking an option blurs the input before its click registers.
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

  const active = open ? filtered[activeIndex] : undefined;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        // Open *at* the first option rather than opening and advancing past it.
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      // Only while the list is visible: after Escape the highlight is still
      // set, and picking from an invisible list is a navigation nobody asked
      // for.
      if (!open) return;
      const league = filtered[activeIndex];
      if (league) {
        event.preventDefault();
        onSelect(league.league_id);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Tab") {
      // Leaving the field must not leave the popup painted over the page.
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={active ? optionId(active.league_id) : undefined}
        aria-label="Search your leagues"
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={`${CONSOLE_WELL} w-full px-4 py-2.5 text-[16px] text-foreground/90 outline-none placeholder:text-foreground/35 focus-visible:border-active/45 disabled:text-foreground/40 @md:text-sm`}
      />

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-foreground/10 bg-[image:var(--panel-bg)] shadow-[var(--panel-shadow)]">
          {filtered.length === 0 ? (
            /* Not an option, so not inside the listbox: a listbox may only own
               options, and an empty-state row is not one. */
            <p
              role="presentation"
              className="px-4 py-3 font-mono text-[0.75rem] text-foreground/45"
            >
              No leagues match “{query.trim()}”.
            </p>
          ) : (
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="Your leagues"
              className="max-h-72 overflow-y-auto"
            >
              {filtered.map((league, index) => (
                <li
                  key={league.league_id}
                  id={optionId(league.league_id)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onPointerDown={(event) => {
                    // Before the input's blur can close the list.
                    event.preventDefault();
                    onSelect(league.league_id);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`cursor-pointer truncate px-4 py-2.5 font-mono text-[0.8125rem] ${
                    index === activeIndex
                      ? "bg-active/12 text-readout"
                      : "text-foreground/75"
                  }`}
                >
                  {league.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
