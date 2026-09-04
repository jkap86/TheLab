"use client";

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

import type { ManagerLeague } from "@/shared/contract";
import { CONSOLE_KEY_PILL, CONSOLE_READOUT } from "@/features/shared";

import type { Subject, SubjectKind } from "../helpers/league-subjects";

/**
 * The shares drawer: a native `<dialog>` pinned to one edge of the viewport,
 * holding a searchable list of subjects and how many of the manager's leagues
 * each one is in.
 *
 * **It is the native element for the reason both dialogs are** — `showModal()`
 * brings the focus trap, the Esc-to-close and the `::backdrop` with it, and no
 * dependency. What makes it a drawer rather than a panel is three lines of
 * margin and a full-height box; everything else is `LeagueFiltersDialog`'s shell.
 *
 * **Write the margins as explicit sides, never `m-0` plus an `auto`.** A
 * `<dialog>` is centred by the UA's own `margin: auto`, and Tailwind emits the
 * `m-*` shorthand before the `ml-*`/`mr-*` longhands — so `m-0 ml-auto` is a
 * coin flip decided by emit order, exactly the trap `CONSOLE_KEY_PILL` exists to
 * keep a lit key out of.
 *
 * **The rows are flat, and that is a budget rather than a style.** The league
 * grid pays ~6 composited planes and a filter buffer per card and gates all of
 * it behind `pointer-fine:` because iOS Safari's per-tab GPU budget dies on 113
 * of them. This list is longer — ~1,500 players on that same account — so it
 * spends nothing: no perspective, no `translateZ`, no `drop-shadow` filter.
 * There is nothing here to gate.
 */

const SIDES = {
  left: {
    // Explicit sides, never `m-0` — see the note above.
    dialog: "my-0 ml-0 mr-auto",
    panel: "rounded-r-3xl border-r border-foreground/12",
    animation: "drawer-in-left",
  },
  right: {
    dialog: "my-0 mr-0 ml-auto",
    panel: "rounded-l-3xl border-l border-foreground/12",
    animation: "drawer-in-right",
  },
} as const;

export type SharesDrawerRow = {
  /** Stable across renders and unique within the list — never an index. */
  key: string;
  id: string;
  name: string;
  /** The position badge or the avatar. */
  icon: ReactNode;
  /** A short trailing fact — a team, say. Absent is fine. */
  note?: string | null;
  /** How many of the counted leagues hold this row. */
  held: number;
  /** Which ones, for the disclosure. */
  leagues: ManagerLeague[];
  /** An extra figure or two beside the share, in the caller's vocabulary. */
  extra?: ReactNode;
};

export function SharesDrawer({
  open,
  onClose,
  side,
  kind,
  title,
  noun,
  rows,
  leagueCount,
  loading,
  error,
  emptyMessage,
  chips,
  chipsActive,
  onClearChips,
  selected,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  side: keyof typeof SIDES;
  kind: SubjectKind;
  title: string;
  /** Plural, lower case — "players", "leaguemates". Used in copy and labels. */
  noun: string;
  rows: SharesDrawerRow[];
  /** The denominator: leagues that contributed a roster or a member list. */
  leagueCount: number;
  loading: boolean;
  error: string | null;
  /** What to say when there is genuinely nothing, as opposed to nothing matching. */
  emptyMessage: string;
  /** The players drawer's position filter; absent on the leaguemates one. */
  chips?: ReactNode;
  chipsActive?: boolean;
  onClearChips?: () => void;
  selected: (subject: Subject) => boolean;
  onToggle: (subject: Subject) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const [query, setQuery] = useState("");
  // Expansion is held above the rows so a row is not re-collapsed by anything
  // that re-orders the list beneath it.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (dialog.open) return;
    dialog.showModal();

    // Fine pointer → the search field, which is what the drawer is for.
    // Coarse → the panel itself, so opening it on a phone does not raise the
    // software keyboard over the list it just showed.
    const fine =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: fine)").matches;
    (fine ? inputRef.current : panelRef.current)?.focus();
  }, [open]);

  // Every route out of the drawer clears the search, so reopening it is not a
  // list still narrowed by something typed a minute ago. The *selection* is
  // deliberately not cleared — it is the narrowing on the grid behind.
  const close = () => {
    setQuery("");
    onClose();
  };

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows,
    [rows, needle],
  );

  // A narrowed list scrolled halfway down reads as an empty one.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [needle]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Esc: let the browser close it, but route the state through `close` so
        // the parent's `open` flag cannot drift from the element's.
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        // The dialog element is only ever the click target when the click
        // landed outside the panel.
        if (e.target === e.currentTarget) close();
      }}
      className={`${SIDES[side].dialog} h-dvh max-h-dvh w-[min(32rem,calc(100vw-2.5rem))] max-w-full overflow-hidden bg-transparent p-0 text-foreground backdrop:bg-black/60`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        // `lab-anim` is the app's marker for anything decorative that moves;
        // the `prefers-reduced-motion` rule in globals.css stops all of it at
        // once. There is no exit animation — a native dialog is gone in the
        // frame it closes.
        className={`@container lab-anim relative flex h-full flex-col overflow-hidden bg-background bg-[image:var(--panel-bg)] shadow-[var(--panel-shadow)] outline-none ${SIDES[side].panel}`}
        style={{
          animation: `${SIDES[side].animation} 0.2s cubic-bezier(0.2,0.9,0.3,1)`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--panel-grain)]"
        />

        <div className="relative flex shrink-0 items-center gap-3 border-b border-foreground/9 px-5 py-3.5">
          <span
            id={titleId}
            className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-active"
          >
            {title}
          </span>
          <span
            aria-hidden
            className="h-px flex-1 bg-gradient-to-r from-active/30 via-foreground/[0.06] to-transparent shadow-[0_1px_0_rgba(0,0,0,0.6)]"
          />
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className={`${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] px-2.5 py-[0.3125rem] normal-case tracking-normal text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
          >
            Esc
          </button>
        </div>

        <div className="relative flex shrink-0 flex-col gap-2.5 px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${noun}`}
              aria-label={`Search ${noun}`}
              // 16px or iOS Safari zooms the page on focus.
              className="min-w-0 flex-1 rounded-[0.625rem] border border-black/70 bg-[image:var(--key-bg)] px-3 py-2 text-[16px] text-foreground/85 shadow-[var(--track-shadow)] placeholder:text-foreground/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 @md:text-[0.8125rem]"
            />
            <span
              className={`${CONSOLE_READOUT} inline-flex shrink-0 items-center rounded-[0.625rem] px-3 py-2`}
              role="status"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
              />
              <span className="relative font-mono text-[0.8125rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
                {shown.length}
              </span>
            </span>
          </div>

          {chips}

          <p className="m-0 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/50">
            {/* The denominator is named in words because it is not the league
                count on the page: a league whose roster was never stored
                contributes nothing and is not counted. */}
            Across {leagueCount} league{leagueCount === 1 ? "" : "s"}
          </p>
        </div>

        <div
          ref={listRef}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
        >
          {loading ? (
            <Message>Reading {noun}…</Message>
          ) : error ? (
            <p
              role="alert"
              className="m-0 py-6 font-mono text-[0.8125rem] text-error"
            >
              {error}
            </p>
          ) : shown.length === 0 ? (
            // Two different claims, and the second is the reader's to undo.
            rows.length === 0 ? (
              <Message>{emptyMessage}</Message>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 py-6">
                <Message>
                  {chipsActive
                    ? `No ${noun} match these filters.`
                    : `Nobody by that name.`}
                </Message>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    onClearChips?.();
                  }}
                  className={`${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
                >
                  Clear
                </button>
              </div>
            )
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {shown.map((row) => (
                <ShareRow
                  key={row.key}
                  row={row}
                  leagueCount={leagueCount}
                  selected={selected({ kind, id: row.id })}
                  onSelect={() => onToggle({ kind, id: row.id })}
                  expanded={expanded.has(row.key)}
                  onExpand={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(row.key)) next.add(row.key);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 py-6 font-mono text-[0.8125rem] text-foreground/60">
      {children}
    </p>
  );
}

/**
 * One row: a chevron that expands, and a body that selects.
 *
 * **It cannot be a `<details>`, and that is an accessibility constraint rather
 * than a layout preference.** A `<summary>` maps to a leaf `button`, so a second
 * control nested inside one is unreliably reachable — the same rule that put the
 * lineup checker's Sync key in the disclosure *body* rather than its summary.
 * The two jobs here are genuinely two controls: the chevron says "which
 * leagues", and the body says "narrow the grid to them".
 */
function ShareRow({
  row,
  leagueCount,
  selected,
  onSelect,
  expanded,
  onExpand,
}: {
  row: SharesDrawerRow;
  leagueCount: number;
  selected: boolean;
  onSelect: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const panelId = useId();
  const pct = leagueCount > 0 ? Math.round((row.held / leagueCount) * 100) : 0;

  return (
    <li
      className={`rounded-[0.625rem] border transition-colors ${
        selected
          ? "border-active/45 bg-active/[0.08]"
          : "border-transparent hover:bg-foreground/[0.04]"
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          aria-label={`Show the leagues holding ${row.name}`}
          className="shrink-0 rounded-md px-1.5 py-2 text-[0.5rem] leading-none text-foreground/45 transition-[transform,color] duration-150 hover:text-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
        >
          <span
            aria-hidden
            className={`inline-block transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          >
            ▶
          </span>
        </button>

        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[0.625rem] py-1.5 pr-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
        >
          {row.icon}
          <span className="min-w-0 flex-1 truncate">
            {/* Full opacity on the accent as text, per the theme rule: an alpha
                on it drops light mode's teal below AA. */}
            <span
              className={`block truncate text-[0.8125rem] ${selected ? "font-semibold text-readout" : "text-foreground/85"}`}
            >
              {row.name}
            </span>
            {row.note && (
              <span className="block truncate font-mono text-[0.625rem] uppercase tracking-[0.14em] text-foreground/50">
                {row.note}
              </span>
            )}
          </span>

          {row.extra}

          <ShareMeter held={row.held} of={leagueCount} pct={pct} />
        </button>
      </div>

      {expanded && (
        <ul
          id={panelId}
          className="m-0 list-none border-t border-foreground/8 px-3 py-1.5 pl-9"
        >
          {row.leagues.map((league) => (
            <li
              key={league.league_id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1"
            >
              <span className="min-w-0 truncate text-[0.8125rem] text-foreground/70">
                {league.name}
              </span>
              <span className="shrink-0 whitespace-nowrap font-mono text-[0.625rem] tabular-nums text-foreground/45">
                {league.total_rosters} teams
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The share, as a figure on lit glass with a bar under it.
 *
 * Deliberately **not** the rank ramp: `rankColor` says how *good* a position is,
 * and a share has no good — owning a player in nine leagues is not a better
 * result than owning him in one, it is a different fact. So the fill is the
 * accent at one weight, and the number carries the meaning.
 */
function ShareMeter({
  held,
  of,
  pct,
}: {
  held: number;
  of: number;
  pct: number;
}) {
  return (
    <span
      className={`${CONSOLE_READOUT} flex w-[4.5rem] shrink-0 flex-col gap-1 rounded-[0.375rem] px-2 py-1.5`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
      />
      <span className="relative flex items-baseline justify-between gap-1 font-mono text-[0.6875rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
        <span>
          {held}/{of}
        </span>
        <span className="text-readout/60">{pct}%</span>
      </span>
      <span
        aria-hidden
        className="relative block h-1 rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
      >
        <span
          className="block h-1 rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)]"
          // A held row is never drawn empty: at 1 of 113 a true-width bar is
          // invisible and reads as "none" rather than as "one".
          style={{ width: `${Math.max(pct, held > 0 ? 6 : 0)}%` }}
        />
      </span>
    </span>
  );
}
