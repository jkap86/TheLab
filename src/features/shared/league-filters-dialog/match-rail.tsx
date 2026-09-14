"use client";

import { useId, useMemo, useState } from "react";

import type { ManagerLeague } from "@/shared/contract";
import {
  CONSOLE_CHIP,
  CONSOLE_FIGURE_WELL_SHELL,
  CONSOLE_GLASS,
  CONSOLE_PART_HOUSING_LIT_PINNED,
} from "../console-chrome";
import { Scanlines } from "../ui/card-plate";
import {
  type ActiveFilter,
  activeFilters,
  clearFilter,
  type LeagueFilters,
  leagueBreakdown,
} from "../league-filters";

/**
 * What the draft leaves, and what it is made of.
 *
 * Three readings, in the order the question is asked: how many leagues survive,
 * which filters are doing it (each removable), and what the survivors actually
 * *are* along the axes that say what game is being played. The chips are the
 * only place in the dialog a filter can be undone without going back to the
 * control that set it, which is what makes an over-narrowed selection
 * recoverable in one press.
 *
 * **It is the panel's one *lit* part**, where the three rule bays beside it are
 * resting: they are controls and this is an answer, and the accent ring is the
 * whole of what says which. Same machined housing otherwise — a header ledge
 * over a key-stock body — so the four read as four objects of one kind.
 *
 * ## Below `@4xl` it pins to the foot of the well and collapses
 *
 * Stacked under the controls rather than standing beside them, a part this tall
 * is a reading a reader has to scroll away from their rules to see — and the
 * reading they want while building one is the count, which is on the ledge in
 * both states. So the ledge becomes the toggle, the body is what a press asks
 * for, and **collapsed is where it opens**: the meter, the narrowing chips and
 * the breakdown are the second question, not the first.
 *
 * **This is the one place the panel's "nothing appears or disappears under a
 * press" rule is deliberately broken, and the ledge is why it survives**: the
 * press *is* the reader asking for the space, and the reading they were given
 * does not move when they get it.
 *
 * The ledge is written twice and exactly one of the two is ever rendered — a
 * `<div>` from `@4xl`, a `<button>` below it — which is `WeekStepper`'s rule and
 * its two conditions: neither copy holds state (the flag is this component's,
 * above both), and both gates are `display: none`, which takes the arm that is
 * not on screen out of the accessibility tree as well as out of the flow. A
 * `<button>` at every width that only acted at some of them would be a control
 * that does nothing, which is the thing this panel greys keys to avoid.
 */
export function MatchRail({
  matched,
  total,
  filters,
  onChange,
}: {
  /** The survivors themselves — the breakdown counts over them. */
  matched: readonly ManagerLeague[];
  total: number;
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
}) {
  const active = useMemo(() => activeFilters(filters), [filters]);
  // 0 of 0 is not 0%: an account with no leagues has no share to report.
  const share = total > 0 ? matched.length / total : null;
  // Once per survivor set, not per render: `matched` is the dialog's own memo
  // over the draft, so this holds while the dialog sits closed under a page
  // rendering once per line of the leagues stream.
  const rows = useMemo(() => leagueBreakdown(matched), [matched]);
  // Which of the two states it was last left in is a fact about one sitting,
  // like the columns panel's selected bay — so it is local and unpersisted.
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  /** The ledge's own two readings, which both arms carry. */
  const lamp = (
    <span
      aria-hidden
      className="relative size-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_7px_var(--accent-glow)]"
    />
  );
  const name = (
    <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-16)] font-semibold tracking-[-0.005em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
      Matching
    </span>
  );
  // The ledge's *face* alone rather than `CONSOLE_WINDOW_LEDGE`, on
  // `CONSOLE_BILLET_FACE`'s rule: that constant carries `--window-ledge-shadow`
  // and a shadow list is atomic, so a second `shadow-[…]` beside it would
  // replace the chamfer rather than casting under it.
  const ledge =
    "relative z-[2] flex items-center gap-2.5 bg-[image:var(--window-ledge-bg)] px-[0.8125rem] py-2.5 shadow-[var(--window-ledge-shadow),0_2px_0_rgba(0,0,0,0.7),0_8px_14px_-8px_rgba(0,0,0,0.85)]";

  return (
    <div
      role="group"
      aria-label="Matching leagues"
      className={CONSOLE_PART_HOUSING_LIT_PINNED}
    >
      {/* Collapsed, the count on the ledge is the whole reading — which is what
          lets the body be a press rather than a loss. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className={`${ledge} w-full text-left @4xl:hidden`}
      >
        {lamp}
        {name}
        <span
          className={`${CONSOLE_GLASS} inline-flex shrink-0 items-baseline gap-[0.3125rem] rounded-full border border-active/45 px-2.5 py-1`}
        >
          <Scanlines />
          <span className="relative font-mono text-[length:var(--fs-11)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
            {matched.length}
          </span>
          <span className="relative font-mono text-[length:var(--fs-9)] tabular-nums text-readout-label">
            / {total}
          </span>
        </span>
        <span
          aria-hidden
          className="inline-flex size-[1.375rem] shrink-0 items-center justify-center rounded-full bg-[color:var(--recess-bg)] text-[length:var(--fs-9)] leading-none text-[color:var(--billet-label)] shadow-[var(--track-shadow)]"
        >
          {open ? "▾" : "▴"}
        </span>
      </button>
      {/* Standing beside the controls there is nothing to collapse for, and no
          chip either: the count is the big readout an inch below. */}
      <div className={`${ledge} hidden @4xl:flex`}>
        {lamp}
        {name}
      </div>

      <div
        id={bodyId}
        className={`relative flex-col gap-3.5 bg-[image:var(--key-bg)] px-3 py-[0.8125rem] ${
          open ? "flex" : "hidden @4xl:flex"
        }`}
      >
        {/* The one figure on the panel that is an *answer* rather than a
            control, so it is the one on lit glass. */}
        <div
          role="status"
          className={`${CONSOLE_GLASS} flex items-baseline gap-2 rounded-[0.625rem] border border-black/70 px-3 py-2.5`}
        >
          <Scanlines />
          <span className="relative font-mono text-[length:var(--fs-28)] leading-none tabular-nums text-readout [text-shadow:var(--readout-text-glow)] sm:text-4xl">
            {matched.length}
          </span>
          {/* `--readout-label` rather than an alpha on the readout's own mint:
              in light mode that teal is already near its floor, and an alpha on
              it lands near 2:1. */}
          <span className="relative font-mono text-[length:var(--fs-11)] text-readout-label">
            of {total}
            {share !== null && ` · ${Math.round(share * 100)}%`}
          </span>
        </div>

        {/* The switch channel rather than a meter's own track, and a lit bar
            rather than a flat accent: the part it is set into is machined, so
            the groove is one cut in it and the fill is the only lit thing. */}
        <div className="h-1.5 overflow-hidden rounded-full bg-black/52 shadow-[inset_0_4px_10px_rgba(0,0,0,0.95),inset_0_-1px_0_rgba(255,255,255,0.075)]">
          <div
            className="h-full rounded-full bg-[image:var(--lit-bar-bg)] shadow-[0_0_10px_var(--accent-glow)] transition-[width] duration-200"
            style={{ width: `${(share ?? 0) * 100}%` }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-[color:var(--billet-label)]">
            Narrowing
          </span>
          {active.length === 0 ? (
            <p className="m-0 font-mono text-[length:var(--fs-11)] text-foreground/45">
              Nothing yet — every league is in.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {active.map((entry) => (
                <ActiveChip
                  key={chipKey(entry)}
                  entry={entry}
                  onRemove={() => onChange(clearFilter(filters, entry))}
                />
              ))}
            </div>
          )}
        </div>

        {/* A milled cut between the two blocks: what is narrowing is a list of
            the reader's own presses, and what is below is a fact about what
            survived them. */}
        <span
          aria-hidden
          className="h-px bg-[image:var(--groove)] shadow-[0_1px_0_rgba(255,255,255,0.05)]"
        />

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-[color:var(--billet-label)]">
            Of these {matched.length}
          </span>
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
            {rows.map((row) => (
              <div
                key={row.key}
                className="flex items-baseline justify-between gap-1.5"
              >
                <dt className="truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.04em] text-[color:var(--billet-label)]">
                  {row.label}
                </dt>
                {/* The same figure well the per-rule counts are read out of. */}
                <dd
                  className={`${CONSOLE_FIGURE_WELL_SHELL} m-0 shrink-0 px-2 py-[0.1875rem] font-mono text-[length:var(--fs-10)] tabular-nums text-readout-label shadow-[inset_0_2px_5px_rgba(0,0,0,0.8)]`}
                >
                  {row.count}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

/** Stable across a re-render: a rule's address is its kind and its position. */
function chipKey(entry: ActiveFilter): string {
  return entry.kind === "fixed"
    ? `fixed:${entry.field}`
    : `${entry.kind}:${entry.index}`;
}

function ActiveChip({
  entry,
  onRemove,
}: {
  entry: ActiveFilter;
  onRemove: () => void;
}) {
  return (
    // Chip stock, as the bay's presets are: a small raised part lying in the
    // body, rather than an accent wash. What it *names* is a narrowing in force,
    // which the housing's own lit ring already says for all of them at once.
    <span
      className={`${CONSOLE_CHIP} inline-flex items-center gap-1.5 rounded-[0.4375rem] py-[0.3125rem] pl-2.5 pr-[0.4375rem] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.04em] text-[color:var(--billet-label)]`}
    >
      {entry.label}
      <button
        type="button"
        aria-label={`Stop filtering by ${entry.label}`}
        onClick={onRemove}
        className="leading-none text-foreground/55 transition-colors hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
      >
        ×
      </button>
    </span>
  );
}
