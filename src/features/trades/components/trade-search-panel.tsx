"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar, PositionBadge } from "@/features/shared";
import type { UserInfo } from "@/shared/contract";

import {
  DEFAULT_TRADE_FILTERS,
  pickLabel,
  sideAssetCount,
} from "../filters";
import type { TradeBounds, TradeFilters, TradeOption } from "../filters";
import { useTradeFacets } from "../hooks/use-trade-facets";
import type { LeagueScope } from "../trade-query";
import type { PlayerSummary, TradeManager } from "../types";
import type { PickedName, SearchSlot } from "./trade-search";

/**
 * How many rows a group shows before the search box is the way through.
 *
 * A panel over the board is a door for a reader who knows the name they want,
 * not a list to browse — the same bound the subject rail's panel keeps, and the
 * reason the old three-column picker's 200-row scroller isn't reproduced here.
 */
const GROUP_LIMIT = 8;

/**
 * The results, floating under whichever slot was pressed.
 *
 * **It is a separate module because it is what the split is for.** The bays are
 * on screen at first paint; the facets query behind this is a season-wide grouped
 * aggregate and everything below is markup nobody who doesn't press has to parse.
 *
 * **Mounting is the gate**, so the request is unconditional: the old dialog
 * passed a null request while closed to keep a closed control from costing that
 * aggregate, and this only exists while it is open. Closing unmounts it and
 * cancels anything in flight; the ten-minute stale time makes reopening free,
 * which is the common gesture.
 *
 * **The counts are taken without the selection**, which is what makes committing
 * live safe: a row says how many trades name that player at all, so pressing one
 * cannot move the number beside it. Counted over the narrowed board instead, a
 * menu collapses to its own selection the moment anything is picked and cannot be
 * widened again without being cleared.
 *
 * What it offers depends on the slot: a who-slot takes one manager, an asset slot
 * takes players and picks. That is not a mode the reader has to choose — it is
 * which part of the bay they pressed.
 */
export function TradeSearchPanel({
  id,
  slot,
  filters,
  season,
  scope,
  account,
  bounds,
  players,
  managers,
  onPick,
  onMatch,
}: {
  id: string;
  slot: SearchSlot;
  filters: TradeFilters;
  season: string;
  scope: LeagueScope;
  account: UserInfo | null;
  bounds: TradeBounds;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  onPick: (kind: "manager" | "player" | "pick", id: string, name: PickedName) => void;
  onMatch: (match: "all" | "any") => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Opened to be typed into, so it takes the focus on mount rather than leaving
  // the first keystroke to land on the page behind it.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The selection is stripped from the request, and the circle is not: the
  // counts must not move under a press, but which trades are on this board at
  // all is a fact about the population being counted — menus taken without it
  // would offer players the reader cannot reach.
  const user = account?.user_id ?? null;
  const { circle } = filters;
  const request = useMemo(
    () => ({
      season,
      scope,
      filters: { ...DEFAULT_TRADE_FILTERS, circle },
      bounds,
      user,
    }),
    [season, scope, bounds, circle, user],
  );

  const { data: facets, loading, error } = useTradeFacets(request);
  const names = facets?.names;

  const managerOptions = useMemo(
    () =>
      toOptions(facets?.managers, (id) => ({
        label:
          names?.managers[id]?.display_name || managers[id]?.display_name || id,
      })),
    [facets?.managers, names, managers],
  );
  const playerOptions = useMemo(
    () =>
      toOptions(facets?.players, (id) => {
        const player = names?.players[id] ?? players[id];
        return {
          label: player?.name ?? id,
          note: [player?.position, player?.team].filter(Boolean).join(" · "),
        };
      }),
    [facets?.players, names, players],
  );
  const pickOptions = useMemo(
    // A pick's label is a pure formatting of its own token, which is why the
    // route doesn't send one — it would be a string derivable from the one
    // beside it.
    () => toOptions(facets?.picks, (token) => ({ label: pickLabel(token) })),
    [facets?.picks],
  );

  const side = filters.sides[slot.side];
  const who = slot.kind === "who";

  // Drawn only where a bay holds two assets for it to mean anything about — the
  // rule `MatchToggle` keeps, and the mode reads within a bay so that is the
  // count that decides.
  const graded = filters.sides.some((s) => sideAssetCount(s) > 1);

  return (
    // Floating over the board rather than pushing it: the bays sit inside the
    // element the virtualizer measures. Pinned input, scrolling results — the
    // drawer's rule — and the scroll box takes no `flex-1`, so a short result
    // list leaves a short panel.
    <div
      id={id}
      role="group"
      aria-label={who ? "Filter by manager" : "Filter by player or pick"}
      className={`absolute left-0 right-0 top-full z-30 mt-1.5 flex max-h-[min(60vh,26rem)] flex-col gap-1.5 rounded-xl border border-active/25 bg-gradient-to-b from-[#1b3040] to-[#0d1c27] p-2 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.95),0_0_36px_-16px_rgba(0,255,229,0.35)] sm:w-[28rem] sm:max-w-[calc(100%-1rem)] ${
        // It hangs under the bay that opened it. Anchored to one edge always, a
        // press on the right bay dropped a panel on the left — which reads as a
        // second control rather than as that bay's own list. Below `sm` the bays
        // are stacked and full width, so it spans both and neither end is wrong.
        slot.side === 0 ? "sm:right-auto" : "sm:left-auto"
      }`}
      style={{ animation: "dialog-rise 0.14s cubic-bezier(0.2,0.9,0.3,1)" }}
    >
      <div className="flex shrink-0 items-center gap-2 rounded-lg border border-foreground/10 bg-[#06111b] px-2.5 py-1.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] focus-within:border-active/60">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={who ? "Search managers" : "Search players and picks"}
          aria-label={who ? "Search managers" : "Search players and picks"}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground/30"
        />
      </div>

      {error && !loading && (
        <p className="shrink-0 px-2 py-1 text-[11px] text-amber-300">{error}</p>
      )}

      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain">
        {loading ? (
          <p className="px-2 py-2 text-[12px] text-foreground/40">
            Counting this season&rsquo;s trades…
          </p>
        ) : who ? (
          <ResultGroup
            label="Managers"
            options={managerOptions}
            query={query}
            chosen={side.manager === null ? EMPTY : [side.manager]}
            render={(option) => (
              <Avatar
                url={names?.managers[option.value]?.avatar_url ?? null}
                name={option.label}
              />
            )}
            onPick={(option) =>
              onPick("manager", option.value, {
                name: option.label,
                avatarUrl: names?.managers[option.value]?.avatar_url ?? null,
              })
            }
          />
        ) : (
          <>
            <ResultGroup
              label="Players"
              options={playerOptions}
              query={query}
              chosen={side.players}
              render={(option) => (
                <PositionBadge
                  position={names?.players[option.value]?.position ?? null}
                />
              )}
              onPick={(option) =>
                onPick("player", option.value, {
                  name: option.label,
                  position: names?.players[option.value]?.position ?? null,
                })
              }
            />
            <ResultGroup
              label="Picks"
              options={pickOptions}
              query={query}
              chosen={side.picks}
              onPick={(option) =>
                onPick("pick", option.value, { name: option.label })
              }
            />
          </>
        )}
      </div>

      {/* The mode belongs to the selection, so it rides with the selection —
          which is what taking the three lists out of the settings panel was for.
          Only in the asset slot: a who-slot takes one name and has no set for a
          mode to be about. */}
      {!who && graded && (
        <div className="mt-0.5 flex shrink-0 items-center gap-2 border-t border-foreground/10 px-1 pt-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/40">
            A side got
          </span>
          {(["all", "any"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.match === value}
              onClick={() => onMatch(value)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                filters.match === value
                  ? "lab-chip lab-chip-sm lab-chip-on"
                  : "lab-chip lab-chip-sm text-foreground/60 hover:text-foreground"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY: readonly string[] = [];

/**
 * One kind of thing, searched and capped.
 *
 * Selected rows are hoisted and always shown, so a pick made under one search
 * term doesn't vanish when the term changes and leave the bay above unexplained.
 * The cap applies after that, which is what keeps everything reachable: the way
 * to a player past the busiest few is to type his name, which is what the box is
 * for and what anyone was going to do anyway.
 */
function ResultGroup({
  label,
  options,
  query,
  chosen,
  render,
  onPick,
}: {
  label: string;
  options: readonly TradeOption[];
  query: string;
  chosen: readonly string[];
  /** The row's leading mark — a position pill, an avatar, or nothing. */
  render?: (option: TradeOption) => React.ReactNode;
  onPick: (option: TradeOption) => void;
}) {
  const held = useMemo(() => new Set(chosen), [chosen]);
  const { shown, hidden } = useMemo(() => {
    const term = query.trim().toLowerCase();
    const picked: TradeOption[] = [];
    const rest: TradeOption[] = [];
    for (const option of options) {
      if (held.has(option.value)) picked.push(option);
      else if (!term || option.label.toLowerCase().includes(term)) {
        rest.push(option);
      }
    }
    const matched = picked.length + rest.length;
    return {
      shown: picked.concat(rest.slice(0, Math.max(0, GROUP_LIMIT - picked.length))),
      hidden: Math.max(0, matched - GROUP_LIMIT),
    };
  }, [options, query, held]);

  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/40">
        {label}
      </span>
      {shown.map((option) => {
        const on = held.has(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(option)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-semibold ${
              on
                ? "lab-chip lab-chip-sm lab-chip-on"
                : "lab-chip lab-chip-sm text-foreground/75 hover:text-foreground"
            }`}
          >
            {render?.(option)}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.note && (
              <span
                className={`shrink-0 text-[11px] font-medium ${
                  on ? "text-[#052029]/55" : "text-foreground/40"
                }`}
              >
                {option.note}
              </span>
            )}
            <span
              className={`shrink-0 font-mono text-[10px] tabular-nums ${
                on ? "text-[#052029]/60" : "text-foreground/35"
              }`}
            >
              {option.count.toLocaleString()}
              {/* Nothing visible names this column, and read aloud the row ended
                  in a bare number with no word for it. */}
              <span className="sr-only"> trades</span>
            </span>
          </button>
        );
      })}
      {hidden > 0 && (
        // Said rather than left to be discovered: a truncated list that doesn't
        // say so reads as a player simply not having been traded.
        <p className="px-2 py-1 text-[11px] text-foreground/35">
          {hidden.toLocaleString()} more — type to narrow
        </p>
      )}
    </div>
  );
}

/**
 * A facet list as the panel's options, labelled.
 *
 * The counts arrive ordered by count already; the tiebreak on label is applied
 * here because only this side knows what a value is called — a player's name is a
 * row in another table and a pick's is a formatting of its own token.
 */
function toOptions(
  facets: readonly { value: string; count: number }[] | undefined,
  label: (value: string) => { label: string; note?: string },
): TradeOption[] {
  if (!facets) return [];
  return facets
    .map((facet) => ({ ...label(facet.value), ...facet }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0 text-foreground/45"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}
