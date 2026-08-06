"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Avatar, PositionBadge } from "@/features/shared";
import type { UserInfo } from "@/shared/contract";

// Reached directly rather than through the card's barrel, which exports only
// `TradeCard` — deliberately, so no *other* page can pull a card's parts into
// its graph. This is the same page, and what it takes is two strings with no
// imports behind them: the geometry of a side, read once so the control and the
// card cannot come to different views of it.
import {
  SIDE_SEAM_COLUMN,
  SIDE_ZONE,
} from "./trade-card/trade-card.constants";

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
      {/* One part holding two regions, which is the card's own construction and
          not a resemblance to it: `SIDE_ZONE` and `SIDE_SEAM_COLUMN` come from
          the card itself, so the control cannot drift from the thing it filters.
          No gap — what separates two sides is a cut, not the ground showing
          between two objects — and they stack below `sm` exactly as the card's
          do, which is what the seam's two spellings are already for.
          `.lab-plate` rather than the card's `.lab-slab`: this is the page's
          instrument, not a row in the list. */}
      <div className="lab-plate relative grid rounded-xl sm:grid-cols-2">
        <SideBay
          index={0}
          filters={filters}
          nameOf={nameOf}
          open={open}
          panelId={panelId}
          onOpen={setOpen}
          onChange={onChange}
        />

        <SideBay
          index={1}
          seam
          filters={filters}
          nameOf={nameOf}
          open={open}
          panelId={panelId}
          onOpen={setOpen}
          onChange={onChange}
        />

        {/* On the seam rather than in a column of its own: a middle track would
            put the cut to one side of the key, which reads as the key belonging
            to the bay on its left. */}
        <SwapKey
          inert={empty}
          onClick={() => {
            onChange(swapSides(filters));
            // The bays have traded places, so a panel aimed at one of them is
            // now aimed at the other's contents. Closing is the honest answer.
            close();
          }}
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
 * One bay: a region of the control's face, with a who-slot for a head and what
 * that side took underneath.
 *
 * **It is the card's side, built the way the card builds one** — `SIDE_ZONE` for
 * the inset, the seam for where it starts, and the same head of avatar, name and
 * a flush-right tag. Not a plate: the card stopped drawing one inside itself
 * because a part inside a part is one step too many to read as containment, and
 * a bay is in exactly that position here.
 *
 * The one thing that is not the card's is the trailing tag. A side of a card puts
 * its *value* there under a readout; this puts the word `got`, which is a
 * constant — and spending an instrument face on a constant is the mistake the
 * kickoff timer's note already names.
 */
function SideBay({
  index,
  seam = false,
  filters,
  nameOf,
  open,
  panelId,
  onOpen,
  onChange,
}: {
  index: SideIndex;
  /** Whether this bay is cut off the one before it — the trailing one is. */
  seam?: boolean;
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
    <div className={`${SIDE_ZONE} ${seam ? SIDE_SEAM_COLUMN : ""}`}>
      {/* No parting line under the head, for the card's own reason: with the bay
          no longer a plate, the seam beside it is the only cut this block gets
          and a second one two lines down would be back to drawing a box. */}
      <div className="mb-2 flex items-center gap-2">
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
  // Nothing to flip, so nothing to press — and the app's rule is that a part
  // which does nothing when pressed must not look pressable. It goes entirely
  // rather than sitting inert on the seam, since the seam already says where the
  // boundary is and a dead key on it would be the only ornament on the control.
  if (inert) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Swap the sides"
      // Centred on the part, which is where the seam is: the two bays are equal
      // tracks and each holds a head and a row, so the cut runs through the
      // middle in both geometries — beside the bays from `sm` up, between them
      // stacked.
      className="lab-chip lab-chip-sm absolute left-1/2 top-1/2 z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm text-active"
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
