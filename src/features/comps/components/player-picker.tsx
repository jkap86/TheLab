"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { PositionBadge } from "@/features/shared";

import { SEARCH_FIELD } from "../../shared/control-type";
import { rankByName } from "../../shared/name-search";

import type { CompsPlayerOptionPayload } from "../types";

/**
 * The subject picker: a combobox over every player with stored stats, ranked
 * by what was typed (`rankByName` — the one ranking rule every name field
 * uses). The route already filtered the list to the supported positions, so
 * nothing pickable here can 400 as an unsupported subject.
 */
export function PlayerPicker({
  players,
  loading,
  onSelect,
}: {
  players: CompsPlayerOptionPayload[];
  loading: boolean;
  onSelect: (player: CompsPlayerOptionPayload) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const ranked = useMemo(
    () => rankByName(players, (player) => player.name, query, 12),
    [players, query],
  );

  // Close on a pointer going down outside — robust where a blur handler isn't,
  // since pressing an option blurs the field before its click registers.
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

  const pick = (player: CompsPlayerOptionPayload) => {
    onSelect(player);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, ranked.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const player = ranked[activeIndex];
      if (player) pick(player);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative max-w-md">
      <div className="flex items-center rounded-lg border border-foreground/15 bg-foreground/[0.03] px-4 py-2.5 focus-within:border-active/50 focus-within:ring-1 focus-within:ring-active/40">
        <input
          type="text"
          role="combobox"
          aria-label="Search players"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && ranked[activeIndex] ? optionId(activeIndex) : undefined
          }
          disabled={loading}
          placeholder={loading ? "Loading players…" : "Search a player…"}
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
          className={SEARCH_FIELD}
        />
      </div>
      {open && ranked.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          // The overlay must be opaque — list rows scrolling behind a translucent
          // panel are exactly what it exists to cover — and the page ground has
          // no Tailwind token, so it is read off the custom property directly.
          style={{ backgroundColor: "var(--background)" }}
          className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-foreground/15 py-1 shadow-xl"
        >
          {ranked.map((player, index) => (
            <li key={player.player_id} id={optionId(index)} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onPointerDown={(event) => {
                  // Pick on pointer-down, before the outside-press close runs.
                  event.preventDefault();
                  pick(player);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  index === activeIndex
                    ? "bg-active/10 text-foreground"
                    : "text-foreground/80"
                }`}
              >
                <PositionBadge position={player.position} />
                <span className="min-w-0 flex-1 truncate">{player.name}</span>
                {player.team && (
                  <span className="shrink-0 text-xs text-foreground/40">
                    {player.team}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
