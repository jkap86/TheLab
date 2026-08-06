"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Avatar, PositionBadge } from "@/features/shared";
import type { UserInfo } from "@/shared/contract";

import {
  pickLabel,
  setSideManager,
  swapSides,
  toggleSideAsset,
} from "../filters";
import type { SideIndex, TradeBounds, TradeFilters } from "../filters";
import type { LeagueScope } from "../trade-query";
import type { PlayerSummary, TradeManager } from "../types";

/**
 * The panel behind the press, loaded on demand.
 *
 * The bays are on screen at first paint and the results are not, so what splits
 * off is the facets query, the grouped result list and the match toggle. The
 * trigger stays here for the reason the ledge's does — and the seam is a module
 * boundary rather than an export name, because a `dynamic()` import that names a
 * symbol in its own module splits nothing at all.
 *
 * `ssr: false`: a panel that only exists after a press has no server-rendered
 * state worth having.
 */
const TradeSearchPanel = dynamic(
  () => import("./trade-search-panel").then((m) => m.TradeSearchPanel),
  { ssr: false },
);

/** Which slot of which bay a press opened. */
export type SearchSlot = { side: SideIndex; kind: "who" | "assets" };

/**
 * A name the reader picked, kept so a token stays legible after the panel that
 * named it is gone.
 *
 * The board's own lookup maps only carry what is on the pages it has loaded, and
 * a reader can perfectly well filter by a player who then appears on none of
 * them — which is exactly the search that returns nothing, where an unnamed
 * token would leave them staring at a Sleeper id.
 */
export type PickedName = {
  name: string;
  position?: string | null;
  avatarUrl?: string | null;
};

/**
 * The board's search: two sides of a trade, described.
 *
 * **The control is the card.** Each bay wears the same seated plate a trade card
 * draws a side on — avatar, name, a milled parting line, then what that side
 * took — so the filter and the first result underneath it are the same object at
 * the same size. That is the whole argument for this shape over a direction
 * written on a token: nothing here has to be explained, because the list below is
 * the explanation.
 *
 * One rule covers every question the page answers: **things in the same bay were
 * on the same side of the trade.** A manager and a player together means he
 * received him; on opposite sides means he gave him; two assets opposed with
 * nobody named means one went for the other — which is the question this board's
 * own description leads with and needs no account to ask.
 *
 * Four things are load-bearing:
 *
 * - **An empty bay means don't care.** One bay filled is the board this page had
 *   before the second existed, and both empty is the unnarrowed market. Nothing
 *   about the second half may narrow anything until something is put in it.
 * - **Who and what are different slots**, which is what they are: a side has one
 *   owner and any number of takes. The impossible state — two owners of one side
 *   — cannot be expressed rather than merely avoided.
 * - **The panel floats.** The bays sit inside the element the virtualizer
 *   watches, so a panel that expanded in place would move every card on the board
 *   to answer a question about it.
 * - **It commits live.** A press narrows immediately, and the count in the ledge
 *   below moves with it — the facet counts are taken without the selection, so
 *   nothing a press can do changes the number beside the thing being pressed.
 */
export function TradeSearch({
  filters,
  onChange,
  season,
  scope,
  account,
  bounds,
  players,
  managers,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  season: string;
  /** The league narrowing in force — the facet counts are taken over it. */
  scope: LeagueScope;
  /** The reader's stored account, or null; only the circle needs one. */
  account: UserInfo | null;
  /** The window, already resolved — the facets are counted inside it. */
  bounds: TradeBounds;
  /** Names the board has already resolved, for tokens picked before this mounted. */
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
}) {
  const [open, setOpen] = useState<SearchSlot | null>(null);
  const [picked, setPicked] = useState<Record<string, PickedName>>({});
  const boxRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(null), []);

  // A press outside the control dismisses it. Pointer-down rather than click, so
  // dragging out of it doesn't leave it up — the gesture the subject rail's panel
  // and the ADP drawer's floats already answer to.
  useEffect(() => {
    if (open === null) return;
    const dismiss = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, close]);

  // Escape closes the innermost thing that is up, which here is the panel.
  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const remember = (id: string, name: PickedName) =>
    setPicked((held) => (held[id] ? held : { ...held, [id]: name }));

  const nameOf = (id: string): PickedName => {
    const held = picked[id];
    if (held) return held;
    const player = players[id];
    if (player) return { name: player.name, position: player.position };
    const manager = managers[id];
    if (manager) {
      // Sleeper leaves a display name null often enough that a bay would draw a
      // blank token; the id is ugly and true, which is the trade this whole
      // resolver makes.
      return { name: manager.display_name ?? id, avatarUrl: manager.avatar_url };
    }
    return { name: id };
  };

  const empty = filters.sides.every(
    (side) =>
      side.manager === null && side.players.length + side.picks.length === 0,
  );

  return (
    <div ref={boxRef} className="relative mb-3">
      {/* Two bays either side of the swap from `sm` up, stacked below it — which
          is what the card's own sides do at that width, and for the same reason:
          a bay is ~150px on a phone and every name in it would wrap. */}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <SideBay
          index={0}
          filters={filters}
          nameOf={nameOf}
          open={open}
          panelId={panelId}
          onOpen={setOpen}
          onChange={onChange}
        />

        <SwapKey
          inert={empty}
          onClick={() => {
            onChange(swapSides(filters));
            // The bays have traded places, so a panel aimed at one of them is
            // now aimed at the other's contents. Closing is the honest answer.
            close();
          }}
        />

        <SideBay
          index={1}
          filters={filters}
          nameOf={nameOf}
          open={open}
          panelId={panelId}
          onOpen={setOpen}
          onChange={onChange}
        />
      </div>

      {open !== null && (
        <TradeSearchPanel
          id={panelId}
          slot={open}
          filters={filters}
          season={season}
          scope={scope}
          account={account}
          bounds={bounds}
          players={players}
          managers={managers}
          onMatch={(match) => onChange({ ...filters, match })}
          onPick={(kind, id, name) => {
            remember(id, name);
            onChange(
              kind === "manager"
                ? setSideManager(
                    filters,
                    open.side,
                    filters.sides[open.side].manager === id ? null : id,
                  )
                : toggleSideAsset(filters, open.side, kind, id),
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * One bay: the card's seated side plate, with a who-slot for a head and what that
 * side took underneath.
 *
 * The materials are the card's own (`lab-plate-sm lab-plate-brushed`, the milled
 * parting line under the head), because looking like the thing it filters is the
 * feature rather than a flourish.
 */
function SideBay({
  index,
  filters,
  nameOf,
  open,
  panelId,
  onOpen,
  onChange,
}: {
  index: SideIndex;
  filters: TradeFilters;
  nameOf: (id: string) => PickedName;
  open: SearchSlot | null;
  panelId: string;
  onOpen: (slot: SearchSlot) => void;
  onChange: (filters: TradeFilters) => void;
}) {
  const side = filters.sides[index];
  const manager = side.manager === null ? null : nameOf(side.manager);
  const armed = (kind: SearchSlot["kind"]) =>
    open?.side === index && open.kind === kind;

  return (
    <div className="lab-plate-sm lab-plate-brushed flex flex-col rounded-lg px-2.5 py-2.5">
      {/* The head, and the parting line under it is the card's — a dark cut with
          a lit far lip rather than a border, so the two parts read as milled from
          one piece. */}
      <div className="mb-2 flex items-center gap-2 pb-2 shadow-[0_1px_0_rgba(0,0,0,0.6),0_2px_0_rgba(255,255,255,0.06)]">
        <button
          type="button"
          onClick={() => onOpen({ side: index, kind: "who" })}
          aria-expanded={armed("who")}
          aria-controls={armed("who") ? panelId : undefined}
          className={`flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-[13px] transition-colors ${
            manager
              ? "font-bold text-foreground hover:text-active"
              : "font-semibold text-active/70 hover:text-active"
          }`}
        >
          {manager ? (
            <>
              <Avatar url={manager.avatarUrl ?? null} name={manager.name} />
              <span className="min-w-0 truncate">{manager.name}</span>
            </>
          ) : (
            // An invitation rather than a hole: an unnamed side is "anyone got
            // this", which is the whole-market question and a perfectly good one
            // to leave standing.
            <span className="truncate">+ anyone</span>
          )}
        </button>

        {manager && (
          <button
            type="button"
            aria-label={`Stop filtering by ${manager.name}`}
            onClick={() => onChange(setSideManager(filters, index, null))}
            className="shrink-0 px-0.5 leading-none text-foreground/45 transition-colors hover:text-[#ff5f6d]"
          >
            ×
          </button>
        )}

        {/* Printed rather than derived from the other bay, so each side states
            its own direction without depending on what its neighbour knows. */}
        <span className="ml-auto shrink-0 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-foreground/45">
          got
        </span>
      </div>

      <div className="flex min-h-[2rem] flex-wrap items-center gap-1.5">
        {side.players.map((id) => {
          const player = nameOf(id);
          return (
            <AssetToken
              key={id}
              label={player.name}
              badge={<PositionBadge position={player.position ?? null} />}
              onRemove={() =>
                onChange(toggleSideAsset(filters, index, "player", id))
              }
            />
          );
        })}
        {/* No badge: the card marks a pick with a bullet rather than a position
            pill, and "2027 1st" says what it is without help — where a `PICK`
            pill would be a badge this app draws nowhere else. */}
        {side.picks.map((token) => (
          <AssetToken
            key={token}
            label={pickLabel(token)}
            onRemove={() =>
              onChange(toggleSideAsset(filters, index, "pick", token))
            }
          />
        ))}

        <button
          type="button"
          onClick={() => onOpen({ side: index, kind: "assets" })}
          aria-expanded={armed("assets")}
          aria-controls={armed("assets") ? panelId : undefined}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-active/70 transition-colors hover:text-active"
        >
          + add
        </button>
      </div>
    </div>
  );
}

/** One asset in a bay, named and dismissable — the subject rail's token. */
function AssetToken({
  label,
  badge = null,
  onRemove,
}: {
  label: string;
  /** A player's position pill; a pick has none — see the call site. */
  badge?: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-active/30 bg-active/10 py-0.5 pl-1 pr-1 text-[11px] text-foreground/90">
      {badge}
      <span className="max-w-[9rem] truncate">{label}</span>
      <button
        type="button"
        aria-label={`Stop filtering by ${label}`}
        onClick={onRemove}
        className="px-0.5 leading-none text-foreground/45 transition-colors hover:text-[#ff5f6d]"
      >
        ×
      </button>
    </span>
  );
}

/**
 * The key between the bays.
 *
 * Inert while both are empty — there is nothing to flip, and the app's rule is
 * that a part which does nothing when pressed must not look pressable, so it
 * loses its wall rather than only dimming.
 */
function SwapKey({ inert, onClick }: { inert: boolean; onClick: () => void }) {
  if (inert) {
    return (
      <span
        aria-hidden="true"
        className="hidden select-none self-center text-sm text-foreground/20 sm:block"
      >
        ⇄
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Swap the sides"
      className="lab-chip lab-chip-sm mx-auto flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-sm text-active"
    >
      {/* Two glyphs rather than one rotated, because the bays are side by side
          from `sm` up and stacked below it — an arrow pair has to point the way
          the parts actually sit. */}
      <span aria-hidden="true" className="sm:hidden">
        ⇅
      </span>
      <span aria-hidden="true" className="hidden sm:inline">
        ⇄
      </span>
      <span className="sr-only">Swap the sides</span>
    </button>
  );
}
