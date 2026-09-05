"use client";

import { type ReactNode, useId, useLayoutEffect, useMemo, useRef } from "react";

import {
  CONSOLE_KEY_PILL,
  CONSOLE_WELL,
  CONSOLE_WINDOW,
  Scanlines,
} from "@/features/shared";

import {
  activeFilterCount,
  facetCounts,
  playerFilterSummary,
  positionRank,
  spanActive,
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
 */
export function PlayerFilters({
  players,
  filters,
  onChange,
  ageBounds,
  classBounds,
  open,
  onToggleOpen,
}: {
  /** The unfiltered population — every count on screen is folded over it. */
  players: readonly PlayerShare[];
  filters: PlayerFilterState;
  onChange: (next: PlayerFilterState) => void;
  ageBounds: Span;
  classBounds: Span;
  open: boolean;
  onToggleOpen: () => void;
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
      <FiltersKey open={open} count={active} onPress={onToggleOpen} controls={trayId} />
      <FilterTray id={trayId} open={open}>
        <div className={`${CONSOLE_WELL} flex flex-col gap-[0.4375rem] p-2`}>
          <FacetRow label="Pos">
            <Chip
              label="All"
              count={players.length}
              on={filters.positions.length === 0}
              onPick={() => set({ positions: [] })}
            />
            {positions.map(([value, count]) => (
              <Chip
                key={value}
                label={value}
                count={count}
                on={filters.positions.includes(value)}
                onPick={() => set({ positions: toggleFacet(filters.positions, value) })}
              />
            ))}
          </FacetRow>

          <Groove />

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
              active={spanActive(filters.age, ageBounds)}
              onChange={(age) => set({ age })}
            />
          )}

          {classBounds && (
            <RangeRow
              label="Class"
              noun="draft class"
              bounds={classBounds}
              span={filters.draftClass ?? classBounds}
              active={spanActive(filters.draftClass, classBounds)}
              onChange={(draftClass) => set({ draftClass })}
            />
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/42">
              {summary ?? "Nothing narrowed"}
            </span>
            <button
              type="button"
              disabled={active === 0}
              onClick={() => onChange({ positions: [], teams: [], age: null, draftClass: null })}
              className={`${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] px-[0.5625rem] py-1 text-[length:var(--fs-10)] tracking-[0.14em] shadow-[var(--key-shadow)] ${
                active === 0
                  ? "cursor-default text-foreground/30"
                  : "text-foreground/80 hover:text-readout"
              }`}
            >
              Clear all
            </button>
          </div>
        </div>
      </FilterTray>
    </>
  );
}

/**
 * The collapsible shell the tray rides in.
 *
 * **The open height is measured, not a `0fr`→`1fr` grid row.** Chrome's `fr`
 * interpolation stalls whenever the subtree is written to in the same frame,
 * which leaves the tray frozen open with nothing on screen saying why — and a
 * `max-height` guess either clips a wrapped row of team chips or eases against
 * a number nothing on screen matches. The inner wrapper is unconstrained (the
 * shell above it does the clipping) so its `offsetHeight` is the natural
 * content height, and a `ResizeObserver` on it is what keeps that true when a
 * chip row wraps or the panel is resized under an open tray.
 *
 * **It takes a full basis and `min-h-0`.** The deck's search row is the
 * wrapping container it sits in — see the note there — so the basis is what
 * puts it on a line of its own, and the negative margin it carries while shut
 * is what cancels that line's gap. `min-h-0` is kept for the reason it is on
 * the list tray below: `min-height: auto` is a content-based floor that would
 * pin a collapsed flex item at its open height the moment this is laid out in
 * a column instead.
 *
 * **The transition list is identical in both states.** Rewriting `transition`
 * in the same frame as the animated property cancels the transition, which is
 * why the state carries opacity and a margin and nothing else — and why focus
 * is taken out of the collapsed tray with `inert` rather than with a
 * `visibility` that would have to be delayed.
 *
 * **`inert` is what takes the collapsed controls out of the tab order.**
 * `pointer-events: none` stops the mouse and nothing else; without it a
 * keyboard reader tabs out of the search field into an invisible panel of
 * chips, a menu and four range handles.
 */
function FilterTray({
  id,
  open,
  children,
}: {
  id: string;
  open: boolean;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const tray = trayRef.current;
    if (!shell || !tray) return;
    const apply = () => {
      shell.style.height = open ? `${tray.offsetHeight}px` : "0px";
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(tray);
    return () => observer.disconnect();
  }, [open]);

  return (
    <div
      ref={shellRef}
      // `lab-anim` is the app's marker for anything decorative that moves, so
      // reduced motion opens the tray at once rather than not at all.
      className={`lab-anim min-h-0 shrink-0 basis-full overflow-hidden [transition:height_260ms_cubic-bezier(0.2,0.9,0.3,1),opacity_200ms_ease,margin-top_260ms_cubic-bezier(0.2,0.9,0.3,1)] ${
        open ? "opacity-100" : "pointer-events-none -mt-[0.3125rem] opacity-0"
      }`}
    >
      <div ref={trayRef} id={id} inert={!open}>
        {children}
      </div>
    </div>
  );
}

/**
 * The key the tray hangs off, in the search row.
 *
 * **The badge counts facets, not values**, and it is what makes a closed tray
 * honest: a reader who narrowed to two positions and a team and then collapsed
 * it can still see that two questions are answered without reopening.
 */
function FiltersKey({
  open,
  count,
  onPress,
  controls,
}: {
  open: boolean;
  count: number;
  onPress: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onPress}
      className={`${CONSOLE_KEY_PILL} inline-flex items-center gap-1.5 bg-[image:var(--key-bg)] px-[0.5625rem] py-[0.4375rem] text-[length:var(--fs-10)] tracking-[0.14em] shadow-[var(--key-shadow)] ${
        open || count > 0
          ? "border-active/45 text-readout"
          : "border-foreground/10 text-foreground/75 hover:text-readout"
      }`}
    >
      <span
        aria-hidden
        className={`lab-anim inline-block text-[length:var(--fs-8)] leading-none transition-transform duration-[260ms] ease-[cubic-bezier(0.2,0.9,0.3,1)] ${
          open ? "rotate-90" : "rotate-0"
        }`}
      >
        ▶
      </span>
      Filters
      {count > 0 && (
        <span className="inline-flex min-w-[0.9375rem] justify-center rounded-full bg-active/16 px-1 py-px tabular-nums text-readout">
          {count}
        </span>
      )}
    </button>
  );
}

function FacetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-[0.5625rem]">
      <span className="w-[2.375rem] shrink-0 pt-[0.3125rem] font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/48">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Groove() {
  return (
    <span
      aria-hidden
      className="h-px bg-[linear-gradient(to_right,transparent,rgba(0,0,0,0.55),transparent)] shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent)]"
    />
  );
}

/**
 * A chosen chip is drawn **lit**, not dimmed — the theme rule against an alpha
 * on the accent as text, and it has the advantage of being true: pressing it
 * again clears it.
 */
function Chip({
  label,
  count,
  on,
  onPick,
}: {
  label: string;
  count: number;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={`${CONSOLE_KEY_PILL} inline-flex items-center bg-[image:var(--key-bg)] px-[0.5625rem] py-1 text-[length:var(--fs-10)] tracking-[0.14em] shadow-[var(--key-shadow)] ${
        on
          ? "border-active/45 text-readout"
          : "border-foreground/10 text-foreground/75 hover:text-readout"
      }`}
    >
      {label}
      <span className="ml-1.5 tabular-nums text-foreground/45">{count}</span>
    </button>
  );
}

/**
 * A two-handle span over a milled track, with the figures in a lit window.
 *
 * **Two stacked `<input type="range">`s**, not a library and not a pointer
 * handler: the native control brings arrow keys, Home/End, page steps and the
 * platform's own touch target with it, and a range is one of the few controls
 * where the native element is genuinely the better one. The inputs are
 * `pointer-events: none` with the thumbs re-enabled (`.lab-range`), which is
 * what lets the two overlap without the upper one swallowing the lower one's
 * handle. Each handle clamps against the other rather than crossing it.
 *
 * **The readout is quiet until the span is a filter.** The label is the numbers
 * either way — a prefix like "Any ·" is 99px of a 66px window and clips at both
 * ends — so the *state* is carried by the ink: `--readout-label` while it sits
 * on both bounds, lit with the glow once it narrows.
 */
function RangeRow({
  label,
  noun,
  bounds,
  span,
  active,
  onChange,
}: {
  label: string;
  /** What the handles are named in their accessible labels — "draft class". */
  noun: string;
  bounds: NonNullable<Span>;
  span: NonNullable<Span>;
  active: boolean;
  onChange: (span: NonNullable<Span>) => void;
}) {
  const pct = (v: number) => ((v - bounds.lo) / (bounds.hi - bounds.lo)) * 100;
  // The 7px inset and the 14px thumb: the fill has to start at the thumb's
  // centre, or it runs out from under the handle at either end.
  const inset = (p: number) => `calc(7px + ${p}% - ${(p / 100) * 14}px)`;

  return (
    <div className="flex items-center gap-[0.5625rem]">
      <span className="w-[2.375rem] shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/48">
        {label}
      </span>

      <div className="relative h-[1.125rem] min-w-0 flex-1">
        <span
          aria-hidden
          className="absolute inset-x-[7px] top-[7px] h-1 rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
        />
        <span
          aria-hidden
          className="absolute top-[7px] h-1 rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)]"
          style={{ left: inset(pct(span.lo)), right: inset(100 - pct(span.hi)) }}
        />
        <input
          className="lab-range"
          type="range"
          min={bounds.lo}
          max={bounds.hi}
          step={1}
          value={span.lo}
          aria-label={`Minimum ${noun}`}
          onChange={(e) =>
            onChange({ lo: Math.min(Number(e.target.value), span.hi), hi: span.hi })
          }
        />
        <input
          className="lab-range"
          type="range"
          min={bounds.lo}
          max={bounds.hi}
          step={1}
          value={span.hi}
          aria-label={`Maximum ${noun}`}
          onChange={(e) =>
            onChange({ lo: span.lo, hi: Math.max(Number(e.target.value), span.lo) })
          }
        />
      </div>

      <span
        className={`${CONSOLE_WINDOW} inline-flex w-[4.75rem] shrink-0 justify-center rounded-[0.4375rem] px-2 py-[0.1875rem]`}
      >
        <Scanlines />
        <span
          className={`relative whitespace-nowrap font-mono text-[length:var(--fs-11)] tabular-nums ${
            active ? "text-readout [text-shadow:var(--readout-text-glow)]" : "text-readout-label"
          }`}
        >
          {span.lo}–{span.hi}
        </span>
      </span>
    </div>
  );
}
