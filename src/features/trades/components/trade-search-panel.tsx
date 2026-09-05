"use client";

import { useMemo, useState } from "react";

import { CONSOLE_KEY } from "@/features/shared";

import { pickLabel } from "../filters";
import type { TradeFilters, TradeNames, TradeOption } from "../filters";
import { useTradeFacets } from "../hooks/use-trade-facets";
import type { TradeRequest } from "../trade-query";
import type { SearchSlot } from "./trade-search";

/**
 * The picker for one slot: what a season actually traded, with how many trades
 * name each thing.
 *
 * **The options are read off the trades rather than from a fixed list.** A
 * fixed list would offer players nobody traded while hiding the one someone
 * wants; what a season moved is the only honest answer to "who can I filter
 * by".
 *
 * **The counts describe the population the selection is made *against*, not the
 * selection.** Counted the other way each menu would collapse to its own
 * selection the moment you made one, and could not be widened without being
 * cleared first. That rule lives on the server (`facetsQuery`), so the request
 * this sends deliberately carries the scope and the window and not the bays.
 *
 * Mounting **is** the gate on the request — the panel unmounts when it closes —
 * so a reader who never opens one never pays for three grouped aggregates.
 */
const GROUP_LIMIT = 12;

export function TradeSearchPanel({
  slot,
  filters,
  onPick,
  onClose,
  names,
  request,
  requestKey,
}: {
  slot: SearchSlot;
  filters: TradeFilters;
  onPick: (value: string) => void;
  onClose: () => void;
  names: TradeNames;
  request: TradeRequest;
  requestKey: string;
}) {
  const [query, setQuery] = useState("");
  const { data, loading, error } = useTradeFacets(request, requestKey);

  const side = filters.sides[slot.side];
  const chosen = useMemo(() => {
    if (slot.kind === "manager") {
      return new Set(side.manager ? [side.manager] : []);
    }
    return new Set(slot.kind === "players" ? side.players : side.picks);
  }, [slot.kind, side]);

  const options = useMemo<TradeOption[]>(() => {
    if (!data) return [];
    const facets =
      slot.kind === "manager"
        ? data.managers
        : slot.kind === "players"
          ? data.players
          : data.picks;

    // **Named from the payload's own `names` first, and only then from what
    // the board has loaded.** A facet can name a player no loaded page does —
    // that is exactly why the two travel together — so preferring the board's
    // map would print an id beside a position and a team the panel *did*
    // resolve, which reads as a rendering fault rather than as missing data.
    return facets.map((facet) => ({
      value: facet.value,
      label:
        slot.kind === "manager"
          ? (data.names.managers[facet.value]?.display_name ??
            names.manager(facet.value))
          : slot.kind === "players"
            ? (data.names.players[facet.value]?.name ??
              names.player(facet.value))
            : // A pick's label is a pure formatting of its own token, which is
              // why the payload sends no name for one.
              pickLabel(facet.value),
      note:
        slot.kind === "players"
          ? positionNote(data.names.players[facet.value])
          : undefined,
      count: facet.count,
    }));
  }, [data, slot.kind, names]);

  // Filtered on the label rather than the id: a reader is typing a name.
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const matched = needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle))
      : options;
    return matched.slice(0, GROUP_LIMIT);
  }, [options, needle]);

  return (
    <div className="mt-3 rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <input
          type="search"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${slot.kind === "manager" ? "managers" : slot.kind}`}
          aria-label={`Search ${slot.kind === "manager" ? "managers" : slot.kind}`}
          className="min-w-0 flex-1 rounded-lg border border-foreground/12 bg-foreground/[0.04] px-3 py-1.5 text-[length:var(--fs-13)] text-foreground/85 placeholder:text-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
        />
        <button type="button" onClick={onClose} className={CONSOLE_KEY}>
          Done
        </button>
      </div>

      {loading ? (
        <p className="py-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
          Counting…
        </p>
      ) : error ? (
        <p
          role="alert"
          className="py-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-error"
        >
          {error}
        </p>
      ) : shown.length === 0 ? (
        <p className="py-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
          {/* Two different claims: nothing was traded in this scope at all, or
              nothing here matches what was typed. */}
          {options.length === 0 ? "Nothing traded here" : "No matches"}
        </p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {shown.map((option) => {
            const on = chosen.has(option.value);
            return (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => onPick(option.value)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[length:var(--fs-13)] hover:bg-foreground/[0.05] ${
                    // An added option is drawn *lit* rather than dimmed: the
                    // theme rule against alpha on the accent as text, and it
                    // has the advantage of being true — pressing again removes
                    // it.
                    on ? "text-active" : "text-foreground/80"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                    {option.note && (
                      <span className="ml-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-foreground/60">
                        {option.note}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[length:var(--fs-11)] tabular-nums text-foreground/60">
                    {option.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {options.length > shown.length && (
        <p className="mt-2 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-foreground/60">
          {options.length - shown.length} more — narrow with the search field
        </p>
      )}
    </div>
  );
}

function positionNote(
  player: { position: string | null; team: string | null } | undefined,
): string | undefined {
  if (!player?.position) return undefined;
  return player.team ? `${player.position} · ${player.team}` : player.position;
}
