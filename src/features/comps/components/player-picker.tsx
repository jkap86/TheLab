"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

// Deep-imported rather than taken off `@/features/shared`: the badge is a span
// and a colour table, where the barrel is the query client, the ADP apparatus
// and `next/dynamic` — one module to the bundler, and to Node's test runner.
import { PositionBadge } from "@/features/shared/ui/position-badge";

import {
  clampActiveIndex,
  comboboxActiveDescendant,
  comboboxKeydownHandler,
  comboboxListboxId,
  comboboxOptionId,
} from "../../shared/combobox";
import { SEARCH_FIELD } from "../../shared/control-type";
import { rankByName } from "../../shared/name-search";

import type { CompsPlayerOptionPayload } from "../types";

/**
 * The subject picker: a combobox over every player with stored stats, ranked
 * by what was typed (`rankByName` — the one ranking rule every name field
 * uses). The route already filtered the list to the supported positions, so
 * nothing pickable here can 400 as an unsupported subject.
 *
 * **The field is the only focusable part, and that is the whole design.** Each
 * suggestion used to be a `<button>` inside its `role="option"`, which is two
 * interaction models over one control: twelve extra tab stops between the
 * search box and the rest of the page, Enter on one firing a `click` nothing
 * listened for, and `aria-activedescendant` naming an option the field had lost
 * ownership of the moment focus moved. Options are plain `<li>`s now, named
 * through `aria-activedescendant`, and every key is decided by
 * `shared/combobox` — see that module for what each one means.
 *
 * **Two things close the popup, and they are not duplicates.** Focus leaving
 * the field closes it, which is what makes Tab and Shift+Tab behave like Tab
 * anywhere else; a pointer going down outside the control closes it too,
 * because a tap on inert page furniture does not reliably blur a field on iOS
 * and a popup left standing over the page is the failure that costs a reader
 * the next press.
 *
 * **What keeps a mouse or a finger from tripping the first of those is one
 * line**: the popup swallows the default of `mousedown`, so pressing a
 * suggestion never moves focus off the field, and the `click` that follows
 * lands on a row that is still mounted. It replaces a `pointerdown` handler
 * that selected *before the gesture was known to be a tap* — which on a phone
 * meant a drag to scroll the list picked whatever was under the finger.
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
  const listboxId = comboboxListboxId(baseId);

  const ranked = useMemo(
    () => rankByName(players, (player) => player.name, query, 12),
    [players, query],
  );

  // "The reader has not dismissed this" and "there is something to show" are
  // two facts, and only their conjunction is a popup. It is what `aria-expanded`
  // announces, what `aria-controls` may point at, and what a key acts on — the
  // alternative is a field claiming to own a listbox that was never rendered.
  const expanded = open && ranked.length > 0;
  const active = clampActiveIndex(activeIndex, ranked.length);

  // Close on a pointer going down outside. Kept beside the blur below rather
  // than replaced by it: tapping a non-focusable part of the page does not
  // reliably blur a field on iOS, so this is the pointer's half of one rule.
  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [expanded]);

  // Keep the highlighted option in view as the arrows move past the fold.
  useEffect(() => {
    if (!expanded) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);

  const pick = (player: CompsPlayerOptionPayload) => {
    onSelect(player);
    setQuery("");
    setActiveIndex(0);
    setOpen(false);
  };

  // Re-created per render, so the thunks read this render's values. Tab is the
  // one press it declines to consume — the popup shuts and the browser moves
  // focus on exactly as it would from any other field.
  const handleKeyDown = comboboxKeydownHandler<CompsPlayerOptionPayload>({
    isOpen: () => expanded,
    options: () => ranked,
    activeIndex: () => activeIndex,
    onOpen: () => setOpen(true),
    onActivate: setActiveIndex,
    onChoose: pick,
    onClose: () => setOpen(false),
  });

  return (
    <div ref={containerRef} className="relative max-w-md">
      <div className="flex items-center rounded-lg border border-foreground/15 bg-foreground/[0.03] px-4 py-2.5 focus-within:border-active/50 focus-within:ring-1 focus-within:ring-active/40">
        <input
          type="text"
          role="combobox"
          aria-label="Search players"
          aria-expanded={expanded}
          // Only while the popup is really on screen — a combobox permanently
          // pointing at a missing id is a broken relationship rather than a
          // closed one.
          aria-controls={expanded ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded
              ? comboboxActiveDescendant(
                  baseId,
                  ranked,
                  activeIndex,
                  (player) => player.player_id,
                )
              : undefined
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
          // Focus leaving the field is focus leaving the combobox, because
          // nothing else in it can hold focus. A press on a suggestion never
          // gets here — the popup swallows `mousedown`'s default below.
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          className={SEARCH_FIELD}
        />
      </div>
      {expanded && (
        <PlayerOptions
          listRef={listRef}
          id={listboxId}
          baseId={baseId}
          options={ranked}
          activeIndex={active}
          onPick={pick}
          onHover={setActiveIndex}
        />
      )}
    </div>
  );
}

/**
 * The popup, exported so its ARIA can be rendered and read back — the field's
 * own state is a `useState` no test without a DOM can reach, and what is worth
 * pinning here is the open state.
 *
 * No part of it is focusable. `aria-selected` marks the active option and not a
 * chosen one, which is what the combobox pattern means by selection while the
 * list is up: the reader has moved a highlight, and nothing is committed until
 * Enter or a press.
 */
export function PlayerOptions({
  listRef,
  id,
  baseId,
  options,
  activeIndex,
  onPick,
  onHover,
}: {
  listRef?: React.RefObject<HTMLUListElement | null>;
  id: string;
  /** The field's `useId` base — both ends of the id pair are built off it. */
  baseId: string;
  options: readonly CompsPlayerOptionPayload[];
  activeIndex: number;
  onPick: (player: CompsPlayerOptionPayload) => void;
  onHover: (index: number) => void;
}) {
  return (
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      // The one line that lets an option be a plain `<li>` with an `onClick`:
      // without it, `mousedown` moves focus off the field, the blur unmounts
      // this list, and the `click` that would have selected has nothing left to
      // land on. Preventing the default of `mousedown` — rather than acting on
      // `pointerdown` — is also what makes a touch drag scroll the list instead
      // of selecting whatever it started on, since the compatibility mousedown
      // is only synthesised for a tap.
      onMouseDown={(event) => event.preventDefault()}
      // The overlay must be opaque — list rows scrolling behind a translucent
      // panel are exactly what it exists to cover — and the page ground has
      // no Tailwind token, so it is read off the custom property directly.
      style={{ backgroundColor: "var(--background)" }}
      className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-foreground/15 py-1 shadow-xl"
    >
      {options.map((player, index) => (
        <li
          key={player.player_id}
          id={comboboxOptionId(baseId, player.player_id)}
          role="option"
          aria-selected={index === activeIndex}
          onClick={() => onPick(player)}
          onMouseEnter={() => onHover(index)}
          className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
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
        </li>
      ))}
    </ul>
  );
}
