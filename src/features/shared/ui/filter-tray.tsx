"use client";

import { type ReactNode } from "react";

import { CONSOLE_KEY_PILL, CONSOLE_WINDOW } from "../console-chrome";
import { Scanlines } from "./card-plate";
import { spanActive, type Span } from "../facet-span";

/**
 * The parts a Filters tray is made of: the key it hangs off, a labelled facet
 * row, the cut between two of them, a counting chip, and a two-handle span
 * over a milled track.
 *
 * They came out of `features/manager/components/player-filters.tsx` when the
 * gametime board's own tray became a second reader — the line `CONSOLE_KEY`,
 * `ManagerPlate`, `CollapseTray` and `DetailLedge` all moved on. What is here
 * is the **grammar**; each tray keeps its own facets, its own vocabulary and
 * its own state, which is what the props are for.
 *
 * Sharing them is the point rather than a saving. The two trays narrow two
 * different lists and a reader walks between the pages one press apart, so a
 * chip that counted differently, a badge that counted values rather than
 * facets, or a span readout that lit on a different rule would be the drift
 * the console's convergence passes exist to remove — and none of those three
 * has a symptom. The measurements are identical to the pixel because they were
 * one part already; this is the code catching up with the design.
 */

/**
 * The key the tray hangs off, in the caller's own control row.
 *
 * **The badge counts facets, not values**, and it is what makes a closed tray
 * honest: a reader who narrowed to two positions and a team and then collapsed
 * it can still see that two questions are answered without reopening.
 */
export function FiltersKey({
  open,
  count,
  onPress,
  controls,
  className = "",
}: {
  open: boolean;
  count: number;
  onPress: () => void;
  controls: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onPress}
      className={`${CONSOLE_KEY_PILL} ${className} inline-flex items-center gap-1.5 bg-[image:var(--key-bg)] px-[0.5625rem] py-[0.4375rem] text-[length:var(--fs-10)] tracking-[0.14em] shadow-[var(--key-shadow)] ${
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

/** One facet: a stamped word, and whatever answers it wrapping beside it. */
export function FacetRow({
  label,
  align = "start",
  children,
}: {
  label: string;
  /**
   * `start` for a row of chips that may wrap to two lines, `center` for a span
   * row, whose track and readout are one line and want a shared midline. The
   * label's own top padding goes with it, since a word that has to sit on the
   * first line of a wrapping row is the only thing that needs one.
   */
  align?: "start" | "center";
  children: ReactNode;
}) {
  return (
    <div className={`flex gap-[0.5625rem] ${align === "center" ? "items-center" : "items-start"}`}>
      <span
        className={`w-[2.375rem] shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/48 ${
          align === "start" ? "pt-[0.3125rem]" : ""
        }`}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** The cut between two facets — a hairline on the tray's own stock. */
export function FacetGroove() {
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
 *
 * The count beside the label is folded over the **unfiltered** population by
 * every caller, which is the rule that makes a chip reading zero the moment
 * you press it impossible and lets a reader widen without clearing first.
 */
export function FacetChip({
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
 * **The readout is quiet until the span is a filter.** The label is the
 * figures either way — a prefix like "Any ·" is 99px of a 66px window and
 * clips at both ends — so the *state* is carried by the ink: `--readout-label`
 * while it sits on both bounds, lit with the glow once it narrows.
 */
export function RangeRow({
  label,
  noun,
  bounds,
  span,
  onChange,
  format = String,
}: {
  label: string;
  /** What the handles are named in their accessible labels — "draft class". */
  noun: string;
  bounds: NonNullable<Span>;
  span: NonNullable<Span>;
  onChange: (span: NonNullable<Span>) => void;
  /**
   * How a stop on the scale is spelled, where the number is an index rather
   * than the answer.
   *
   * An age and a draft class are their own labels and take the default; the
   * gametime board's clock scale is an ordinal over `Pre Q1 Q2 Q3 Q4 F`, and a
   * readout printing `1–5` there would be a control whose two ends name
   * nothing on the board it narrows. It is a prop rather than two components
   * because the *rule* — which is that the window lights only once the span is
   * a filter — is the same one either way.
   */
  format?: (value: number) => string;
}) {
  const active = spanActive(span, bounds);
  const pct = (v: number) => ((v - bounds.lo) / (bounds.hi - bounds.lo)) * 100;
  // The 7px inset and the 14px thumb: the fill has to start at the thumb's
  // centre, or it runs out from under the handle at either end.
  const inset = (p: number) => `calc(7px + ${p}% - ${(p / 100) * 14}px)`;

  return (
    <FacetRow label={label} align="center">
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
          aria-valuetext={format(span.lo)}
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
          aria-valuetext={format(span.hi)}
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
          {format(span.lo)}–{format(span.hi)}
        </span>
      </span>
    </FacetRow>
  );
}

/**
 * The tray's foot: what it has narrowed to in words, and the key that undoes
 * it.
 *
 * `Clear all` is **disabled at rest** rather than absent, which is this app's
 * own rule for a bound: a key that appeared and disappeared under the reader
 * would move every row of the tray above it each time a facet was answered.
 */
export function FacetFoot({
  summary,
  active,
  onClear,
}: {
  summary: string | null;
  active: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/42">
        {summary ?? "Nothing narrowed"}
      </span>
      <button
        type="button"
        disabled={!active}
        onClick={onClear}
        className={`${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] px-[0.5625rem] py-1 text-[length:var(--fs-10)] tracking-[0.14em] shadow-[var(--key-shadow)] ${
          active ? "text-foreground/80 hover:text-readout" : "cursor-default text-foreground/30"
        }`}
      >
        Clear all
      </button>
    </div>
  );
}
