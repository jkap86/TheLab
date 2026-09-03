"use client";

import { useState } from "react";

import { CONSOLE_KEY } from "@/features/shared";

import {
  EMPTY_SIDE,
  pickLabel,
  sideAssetCount,
  setSideManager,
  sideLabel,
  swapSides,
  toggleSideAsset,
  toggleSideOnly,
} from "../filters";
import type {
  SideIndex,
  TradeFilters,
  TradeNames,
  TradeSideFilter,
} from "../filters";
import { TradeSearchPanel } from "./trade-search-panel";
import type { TradeRequest } from "../trade-query";

/**
 * The two bays a reader describes a trade in, and the picker that fills them.
 *
 * **A bay is a side, and everything in it is what that side received.** There
 * is no "gave" control anywhere, because a give is the other bay's take: "what
 * did he give up" is his name in one bay and the player in the other. That is
 * how a direction gets into this vocabulary without a directional field, and it
 * is the same rule `assembleTrade` stores a trade by.
 *
 * The panel opens against **one slot at a time** — a bay's manager, its
 * players, its picks — because the menus are per category and a picker that
 * showed all three at once would be three lists competing for a phone's height.
 * The slot being open is also what mounts the facets request, so a reader who
 * never opens one never pays for three grouped aggregates.
 */
export type SearchSlot = {
  side: SideIndex;
  kind: "manager" | "players" | "picks";
};

export function TradeSearch({
  filters,
  onChange,
  names,
  request,
  requestKey,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  names: TradeNames;
  /** The facets request: the scope and the window, *without* the selection. */
  request: TradeRequest;
  requestKey: string;
}) {
  const [slot, setSlot] = useState<SearchSlot | null>(null);

  return (
    <div className="mb-6 rounded-2xl border border-foreground/9 bg-[image:var(--panel-bg)] p-4 shadow-[var(--panel-shadow)]">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <Bay
          index={0}
          filters={filters}
          onChange={onChange}
          names={names}
          slot={slot}
          onOpen={setSlot}
        />

        {/* Swapping is one press because the question reverses as often as it
            is asked: "what did he give her" and "what did she give him" are
            the same two bays the other way round. */}
        <button
          type="button"
          onClick={() => {
            onChange(swapSides(filters));
            setSlot(null);
          }}
          className={`${CONSOLE_KEY} self-center`}
          aria-label="Swap the two sides"
        >
          ⇄
        </button>

        <Bay
          index={1}
          filters={filters}
          onChange={onChange}
          names={names}
          slot={slot}
          onOpen={setSlot}
        />
      </div>

      {slot && (
        <TradeSearchPanel
          slot={slot}
          filters={filters}
          onPick={(value) => {
            onChange(
              slot.kind === "manager"
                ? // A second press on the named manager clears the slot: a
                  // who-slot holds one name, so "select" and "deselect" are
                  // the same press. `setSideManager` also clears the *other*
                  // bay of the same name, since a manager is one side.
                  setSideManager(
                    filters,
                    slot.side,
                    filters.sides[slot.side].manager === value ? null : value,
                  )
                : toggleSideAsset(
                    filters,
                    slot.side,
                    slot.kind === "players" ? "player" : "pick",
                    value,
                  ),
            );
          }}
          onClose={() => setSlot(null)}
          names={names}
          request={request}
          requestKey={requestKey}
        />
      )}
    </div>
  );
}

/** One side: who it is, what it took, and whether that is all it took. */
function Bay({
  index,
  filters,
  onChange,
  names,
  slot,
  onOpen,
}: {
  index: SideIndex;
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  names: TradeNames;
  slot: SearchSlot | null;
  onOpen: (slot: SearchSlot | null) => void;
}) {
  const side: TradeSideFilter = filters.sides[index];
  const open = (kind: SearchSlot["kind"]) =>
    slot?.side === index && slot.kind === kind;

  const toggle = (kind: SearchSlot["kind"]) =>
    onOpen(open(kind) ? null : { side: index, kind });

  return (
    <section className="min-w-0 rounded-xl border border-foreground/8 bg-foreground/[0.02] p-3">
      <h3 className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/60">
        {/* The label is the *relation*, not a fixed "side 1": with a manager
            named opposite, this bay is what that manager gave. */}
        {sideLabel(filters, index, names)}
      </h3>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => toggle("manager")}
          aria-expanded={open("manager")}
          className={`${CONSOLE_KEY} ${open("manager") ? "text-readout" : ""}`}
        >
          {side.manager ? names.manager(side.manager) : "Anyone"}
        </button>
        <button
          type="button"
          onClick={() => toggle("players")}
          aria-expanded={open("players")}
          className={`${CONSOLE_KEY} ${open("players") ? "text-readout" : ""}`}
        >
          Players{side.players.length ? ` (${side.players.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => toggle("picks")}
          aria-expanded={open("picks")}
          className={`${CONSOLE_KEY} ${open("picks") ? "text-readout" : ""}`}
        >
          Picks{side.picks.length ? ` (${side.picks.length})` : ""}
        </button>
      </div>

      {sideAssetCount(side) > 0 && (
        <>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {side.players.map((id) => (
              <Token
                key={`p${id}`}
                label={names.player(id)}
                onRemove={() =>
                  onChange(toggleSideAsset(filters, index, "player", id))
                }
              />
            ))}
            {side.picks.map((token) => (
              <Token
                key={`k${token}`}
                label={pickLabel(token)}
                onRemove={() =>
                  onChange(toggleSideAsset(filters, index, "pick", token))
                }
              />
            ))}
          </ul>

          {/* Per bay, because it is a claim about one side: "he gave up only
              Nabers, for whatever he could get" is a claim about exactly one
              of the two. Shown only where the bay names an asset — with
              nothing named it has nothing to exclude *to*, which is the same
              guard the parser and the SQL builder apply. */}
          <label className="mt-2.5 flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/60">
            <input
              type="checkbox"
              checked={side.only}
              onChange={() => onChange(toggleSideOnly(filters, index))}
              className="accent-[var(--active)]"
            />
            and nothing else
          </label>
        </>
      )}
    </section>
  );
}

function Token({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-active/30 bg-active/10 px-2.5 py-1 text-[0.75rem] text-foreground/85 hover:border-active/50"
      >
        <span className="truncate">{label}</span>
        <span aria-hidden className="text-foreground/60">
          ×
        </span>
        <span className="sr-only">Remove</span>
      </button>
    </li>
  );
}

export { EMPTY_SIDE };
