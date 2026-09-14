"use client";

import { useId, useMemo } from "react";

import {
  CollapseTray,
  CONSOLE_KEY_PILL,
  CONSOLE_WELL,
  FacetChip,
  FacetFoot,
  FacetGroove,
  FacetRow,
  FiltersKey,
  RangeRow,
} from "@/features/shared";

import {
  activeFilterCount,
  facetCounts,
  playerFilterSummary,
  positionRank,
  toggleFacet,
  UNKNOWN_VALUE,
  type PlayerFilterState,
  type Span,
} from "../helpers/player-filters";
import type { PlayerShare } from "../helpers/shares";

/**
 * The players drawer's filter tray: Pos, Team, Age and Class, behind one key.
 *
 * **Four facets do not fit in the deck, and the deck is what the panel is not
 * for.** The position chips used to sit in a well of their own under the search
 * field; three more facets there is a control deck taller than the list it
 * narrows — the thing the drawer exists to show. So the key carries a count and
 * the tray carries the controls, and a reader who never opens it pays one key's
 * height for all four.
 *
 * **Multi-select within a facet, AND across them.** A dynasty reader wants
 * "RB or WR, on BAL or KC, under 26" in one pass; single-select made that three
 * separate readings of the same list.
 *
 * Every count on screen is folded over the **unfiltered** population — see
 * `facetCounts`. The state itself and the predicate that reads it live in
 * `helpers/player-filters.ts`, because the decisions in them are silent when
 * wrong and have to resolve under Node's own test runner.
 *
 * **The parts are `features/shared/ui/filter-tray.tsx`'s** since the gametime
 * board's own Filters tray became a second reader of the same grammar: the
 * key and its facet-counting badge, the labelled row, the cut, the counting
 * chip, the two-handle span and the foot. What stays here is this tray's four
 * facets and the vocabulary they are asked in — which is everything a reader
 * of *this* panel sees and nothing they would recognise on the other.
 */
export function PlayerFilters({
  players,
  filters,
  onChange,
  ageBounds,
  classBounds,
  open,
  onToggleOpen,
  keyClassName = "",
  trayClassName = "",
  trayClosedClassName = "",
}: {
  /** The unfiltered population — every count on screen is folded over it. */
  players: readonly PlayerShare[];
  filters: PlayerFilterState;
  onChange: (next: PlayerFilterState) => void;
  ageBounds: Span;
  classBounds: Span;
  open: boolean;
  onToggleOpen: () => void;
  /**
   * Where the key and the tray sit in the caller's row — an `order`, a basis.
   *
   * **The key and the tray are two flex items of the caller's container**, so
   * their layout is the caller's to state and has to land on the items
   * themselves. It used to ride a `display: contents` wrapper at the call site,
   * which is exactly where it cannot work: a `contents` box is not a flex item,
   * so its `order` applies to nothing and the key sorted to the front of the
   * ledge, alone on a line above the search.
   */
  keyClassName?: string;
  trayClassName?: string;
  /**
   * What the tray carries only while shut — the negative margin that cancels
   * the caller's gap above it, which only the caller knows the size of.
   */
  trayClosedClassName?: string;
}) {
  const trayId = useId();
  const active = activeFilterCount(filters, ageBounds, classBounds);
  const summary = playerFilterSummary(filters, ageBounds, classBounds);

  const positions = useMemo(
    () =>
      [...facetCounts(players, (p) => p.position).entries()].sort(
        (a, b) => positionRank(a[0]) - positionRank(b[0]) || a[0].localeCompare(b[0]),
      ),
    [players],
  );
  // Teams are ranked by how many players they would leave, not alphabetically:
  // the menu is 26–32 three-letter codes, and the ones worth reaching for are
  // the ones the manager actually rosters.
  const teamCounts = useMemo(() => facetCounts(players, (p) => p.team), [players]);
  const teams = useMemo(
    () => [...teamCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [teamCounts],
  );

  const set = (patch: Partial<PlayerFilterState>) => onChange({ ...filters, ...patch });

  return (
    <>
      <FiltersKey
        open={open}
        count={active}
        onPress={onToggleOpen}
        controls={trayId}
        className={keyClassName}
      />
      {/* The measured-height shell, now `features/shared`'s — the leaguemate
          panel's expanded row is its second reader. Its basis, its place and
          the negative margin it takes while shut are the caller's: they are
          facts about the caller's row and its gap, not about the tray. */}
      <CollapseTray
        id={trayId}
        open={open}
        className={trayClassName}
        closedClassName={trayClosedClassName}
      >
        <div className={`${CONSOLE_WELL} flex flex-col gap-[0.4375rem] p-2`}>
          <FacetRow label="Pos">
            <FacetChip
              label="All"
              count={players.length}
              on={filters.positions.length === 0}
              onPick={() => set({ positions: [] })}
            />
            {positions.map(([value, count]) => (
              <FacetChip
                key={value}
                label={value}
                count={count}
                on={filters.positions.includes(value)}
                onPick={() => set({ positions: toggleFacet(filters.positions, value) })}
              />
            ))}
          </FacetRow>

          <FacetGroove />

          <FacetRow label="Team">
            {/* A `<select>` rather than 32 chips, and it *adds* rather than
                selects: a native multiple-select is a scrolling list box on
                every platform and a chip row of 32 is the tray's whole height.
                Chosen teams come back out as removable chips, so what is
                narrowed is readable without opening the menu. */}
            <select
              aria-label="Add an NFL team"
              value=""
              onChange={(e) => {
                if (e.target.value) set({ teams: toggleFacet(filters.teams, e.target.value) });
              }}
              className={`${CONSOLE_KEY_PILL} appearance-none border-foreground/10 bg-[image:var(--key-bg)] px-[0.5625rem] py-[0.3125rem] text-[length:var(--fs-10)] tracking-[0.1em] text-foreground/75 shadow-[var(--key-shadow)]`}
            >
              <option value="">+ Add team</option>
              {teams.map(([value, count]) => (
                <option key={value} value={value} disabled={filters.teams.includes(value)}>
                  {value === UNKNOWN_VALUE ? "No team" : value} · {count}
                </option>
              ))}
            </select>

            {filters.teams.map((value) => (
              <button
                key={value}
                type="button"
                title={`Remove ${value}`}
                onClick={() => set({ teams: toggleFacet(filters.teams, value) })}
                className={`${CONSOLE_KEY_PILL} inline-flex items-center gap-1.5 border-active/45 bg-[image:var(--key-bg)] px-[0.5625rem] py-1 text-[length:var(--fs-10)] tracking-[0.14em] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]`}
              >
                {value}
                <span className="tabular-nums text-foreground/45">
                  {teamCounts.get(value) ?? 0}
                </span>
                <span aria-hidden className="text-[length:var(--fs-9)] text-foreground/55">
                  ✕
                </span>
              </button>
            ))}

            {filters.teams.length === 0 && (
              // Read off the options rather than written down: a literal here
              // is a claim, and it drifts the first time the population does.
              <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/36">
                All {teams.length} teams
              </span>
            )}
          </FacetRow>

          {/* A facet with fewer than two distinct values renders no row at all
              — a slider whose handles cannot be apart answers nothing. */}
          {ageBounds && (
            <RangeRow
              label="Age"
              noun="age"
              bounds={ageBounds}
              span={filters.age ?? ageBounds}
              onChange={(age) => set({ age })}
            />
          )}

          {classBounds && (
            <RangeRow
              label="Class"
              noun="draft class"
              bounds={classBounds}
              span={filters.draftClass ?? classBounds}
              onChange={(draftClass) => set({ draftClass })}
            />
          )}

          <FacetFoot
            summary={summary}
            active={active > 0}
            onClear={() => onChange({ positions: [], teams: [], age: null, draftClass: null })}
          />
        </div>
      </CollapseTray>
    </>
  );
}
