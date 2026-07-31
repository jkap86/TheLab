"use client";

import { type PointerEvent as ReactPointerEvent, useMemo, useRef } from "react";

import {
  type AdpRange,
  MONTH_ABBREVIATIONS,
  formatRangeMonth,
  rangeLabel,
  shiftDays,
} from "../adp-controls";
import type { AdpDensityState } from "../hooks/use-adp-density";
import { type NflMarker, nflMarkersIn } from "../nfl-calendar";
import {
  dateAtFraction,
  drawnBounds,
  edgeBounds,
  fractionOf,
  monthBars,
  monthExtent,
  scrubDomain,
} from "../range-domain";

/**
 * The ADP board's window, as a brush over the drafts this app has actually
 * crawled, with the NFL calendar underneath it.
 *
 * It replaces a pair of `mm/dd/yyyy` inputs, and the reason is not that they
 * were ugly: they asked you to name a date while telling you nothing about where
 * the drafts were, so choosing a window meant guessing and then reading the
 * count that came back. The strip answers that first — and the calendar rail
 * answers *why*, because a May spike isn't a May spike, it's the fortnight after
 * the NFL draft.
 *
 * Three things about it are decisions rather than styling:
 *
 *   - **A handle on an edge is an open bound**, not that date (`edgeBounds`).
 *     That is what keeps "all time" reachable by dragging, and what stops the
 *     control from quietly closing a range that was deliberately half-open.
 *   - **The strip is not narrowed by the drawer's other filters.** It would
 *     reshape under the hand choosing them, and a histogram that moves while you
 *     drag across it is worse than none. It follows that the bars and the board's
 *     own draft count are different populations — which is why no count is shown
 *     here, only dates. The header states the real one.
 *   - **The markers are controls.** A band selects itself; the draft flag starts
 *     the window there and leaves the end alone. "Drafts since the NFL draft" is
 *     the most natural cut of a rookie board there is and no fixed preset can
 *     ever carry it, because the date moves every April.
 *
 * All the maths is in `range-domain`; this file lays out pixels and handles
 * pointers. `today` is passed in rather than read from the clock, so the domain
 * only changes when the date does.
 */
export function RangeScrubber({
  range,
  bounds,
  density,
  today,
  onChange,
}: {
  range: AdpRange;
  /** The range resolved against today — a preset's dates, or the custom pair. */
  bounds: { from: string | null; to: string | null };
  density: AdpDensityState;
  /** `YYYY-MM-DD`. */
  today: string;
  onChange: (range: AdpRange) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "from" | "to"; anchor: string | null } | null>(null);

  const domain = useMemo(
    () => scrubDomain(density.months, today),
    [density.months, today],
  );
  const bars = useMemo(() => monthBars(density.months, domain), [density.months, domain]);
  const markers = useMemo(() => nflMarkersIn(domain.from, domain.to), [domain]);
  const peak = bars.reduce((max, b) => Math.max(max, b.drafts), 0);

  const drawn = drawnBounds(bounds, domain);
  const left = fractionOf(domain, drawn.from) * 100;
  const right = fractionOf(domain, drawn.to) * 100;

  const commit = (from: string, to: string) =>
    onChange(edgeBounds(from < to ? from : to, from < to ? to : from, domain));

  /** Where a pointer is, as a date on the axis. */
  const dateAtPointer = (clientX: number): string => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return drawn.from;
    return dateAtFraction(domain, (clientX - rect.left) / rect.width);
  };

  const grabHandle = (mode: "from" | "to", e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, anchor: null };
    // Captured on the track, not the handle, so the move and up events below
    // keep arriving once the pointer leaves the 12px grab target.
    track.current?.setPointerCapture(e.pointerId);
  };

  // Sweeping the strip starts a fresh window rather than nudging whichever
  // handle is nearer: a press on the bars is an intent to reselect, and
  // "nearest handle wins" makes a short window impossible to draw from scratch.
  const startSweep = (e: ReactPointerEvent) => {
    const anchor = dateAtPointer(e.clientX);
    drag.current = { mode: "to", anchor };
    track.current?.setPointerCapture(e.pointerId);
    commit(anchor, anchor);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const active = drag.current;
    if (!active) return;
    const date = dateAtPointer(e.clientX);
    if (active.anchor !== null) commit(active.anchor, date);
    else if (active.mode === "from") commit(date, drawn.to);
    else commit(drawn.from, date);
  };

  const endDrag = () => {
    drag.current = null;
  };

  const nudge = (mode: "from" | "to", days: number) => {
    const date = shiftDays(mode === "from" ? drawn.from : drawn.to, days);
    if (mode === "from") commit(date, drawn.to);
    else commit(drawn.from, date);
  };

  const spanDays =
    Math.round(
      (Date.parse(`${drawn.to}T00:00:00Z`) - Date.parse(`${drawn.from}T00:00:00Z`)) /
        86_400_000,
    ) + 1;

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={track}
        onPointerDown={startSweep}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-14 cursor-crosshair touch-none select-none border-b border-foreground/10"
      >
        {bars.map((bar) => {
          const { left: barLeft, width } = monthExtent(bar.month, domain);
          if (bar.drafts === 0) return null;
          return (
            <div
              key={bar.month}
              title={`${formatRangeMonth(bar.month)} — ${bar.drafts} crawled draft${
                bar.drafts === 1 ? "" : "s"
              }`}
              style={{
                left: `${barLeft * 100}%`,
                // A hair of inset so adjacent months read as separate columns
                // without the gap growing on a long axis.
                width: `calc(${width * 100}% - 1px)`,
                height: `${Math.max(4, (bar.drafts / peak) * 100)}%`,
              }}
              className="absolute bottom-0 rounded-t-[1px] bg-foreground/20"
            />
          );
        })}

        {/* Everything outside the window is dimmed rather than the inside being
            brightened, so the bars keep one weight and the selection reads as a
            window cut in the panel. */}
        <div
          style={{ width: `${left}%` }}
          className="pointer-events-none absolute inset-y-0 left-0 bg-[rgb(12,23,33)]/70"
        />
        <div
          style={{ width: `${100 - right}%` }}
          className="pointer-events-none absolute inset-y-0 right-0 bg-[rgb(12,23,33)]/70"
        />

        {/* Above the scrim: the calendar is context that stays readable whatever
            the selection dims, unlike the bars it explains. */}
        {markers
          .filter((m) => m.kind === "draft")
          .map((m) => (
            <div
              key={m.label}
              style={{ left: `${fractionOf(domain, m.from) * 100}%` }}
              className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-fuchsia-400/45"
            />
          ))}

        <div
          style={{ left: `${left}%`, width: `${right - left}%` }}
          className="pointer-events-none absolute inset-y-0 border-t border-active/50 bg-active/[0.08]"
        />

        <Handle
          position={left}
          label="Window start"
          value={drawn.from}
          domain={domain}
          onGrab={(e) => grabHandle("from", e)}
          onNudge={(days) => nudge("from", days)}
        />
        <Handle
          position={right}
          label="Window end"
          value={drawn.to}
          domain={domain}
          onGrab={(e) => grabHandle("to", e)}
          onNudge={(days) => nudge("to", days)}
        />
      </div>

      <div className="relative h-3.5">
        {markers.map((marker) =>
          marker.kind === "draft" ? (
            <DraftFlag
              key={marker.label}
              marker={marker}
              position={fractionOf(domain, marker.from) * 100}
              onSelect={() => {
                // "Since the draft" is the question the flag answers, so an end
                // now sitting behind the start opens rather than collapsing.
                const to = drawn.to > marker.from ? drawn.to : domain.to;
                commit(marker.from, to);
              }}
            />
          ) : (
            <SeasonBand
              key={marker.label}
              marker={marker}
              domain={domain}
              onSelect={() => commit(marker.from, marker.to)}
            />
          ),
        )}
      </div>

      <div className="relative h-3 text-[0.55rem] tracking-wider text-foreground/30">
        {bars.map((bar) => {
          const month = Number(bar.month.slice(5, 7));
          const january = month === 1;
          if (!january && bars.length > 36) return null;
          const { left: tickLeft, width } = monthExtent(bar.month, domain);
          return (
            <span
              key={bar.month}
              style={{ left: `${tickLeft * 100}%`, width: `${width * 100}%` }}
              className={`absolute overflow-hidden text-center ${
                january ? "text-foreground/50" : ""
              }`}
            >
              {january ? bar.month.slice(0, 4) : MONTH_INITIALS[month - 1]}
            </span>
          );
        })}
      </div>

      <p className="text-[0.7rem] tabular-nums text-foreground/45">
        <span className="text-active">{rangeLabel(range)}</span>
        {bounds.from !== null && bounds.to !== null && (
          <span className="text-foreground/30">
            {" "}
            · {spanDays.toLocaleString()} days
          </span>
        )}
        {density.error ? (
          <span className="text-foreground/30"> · draft activity unavailable</span>
        ) : peak === 0 && !density.loading ? (
          <span className="text-foreground/30"> · no crawled drafts to chart</span>
        ) : null}
      </p>
    </div>
  );
}

/** The axis ticks, off the one month-name list rather than a second spelling. */
const MONTH_INITIALS = MONTH_ABBREVIATIONS.map((m) => m.charAt(0));

/**
 * One end of the window. A real `role="slider"` so it is reachable and nudgeable
 * from the keyboard — the strip is a pointer control first, and a date range
 * that can only be set by dragging isn't a date range everyone can set.
 */
function Handle({
  position,
  label,
  value,
  domain,
  onGrab,
  onNudge,
}: {
  /** Percent across the track. */
  position: number;
  label: string;
  value: string;
  domain: { from: string; to: string };
  onGrab: (e: ReactPointerEvent) => void;
  onNudge: (days: number) => void;
}) {
  const day = (date: string) =>
    Math.round(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${domain.from}T00:00:00Z`)) /
        86_400_000,
    );

  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={day(domain.to)}
      aria-valuenow={day(value)}
      aria-valuetext={value}
      style={{ left: `${position}%` }}
      onPointerDown={onGrab}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 7 : 1;
        if (e.key === "ArrowLeft") onNudge(-step);
        else if (e.key === "ArrowRight") onNudge(step);
        else if (e.key === "PageDown") onNudge(-30);
        else if (e.key === "PageUp") onNudge(30);
        else return;
        e.preventDefault();
      }}
      className="group absolute -top-1 -bottom-1 -ml-1.5 w-3 cursor-ew-resize touch-none"
    >
      <span className="absolute inset-y-0 left-1 w-0.5 rounded-full bg-active shadow-[0_0_8px_rgba(0,255,229,0.5)] group-hover:shadow-[0_0_12px_rgba(0,255,229,0.9)]" />
      <span className="absolute bottom-0 left-0.5 h-2 w-2 rounded-[1px] bg-active" />
    </button>
  );
}

/** A preseason or regular-season span, clickable to take exactly that window. */
function SeasonBand({
  marker,
  domain,
  onSelect,
}: {
  marker: NflMarker;
  domain: { from: string; to: string };
  onSelect: () => void;
}) {
  const left = fractionOf(domain, marker.from);
  const right = fractionOf(domain, marker.to);
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${marker.label} — select this window`}
      aria-label={`Select the ${marker.label}`}
      style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
      className={`absolute inset-y-0 overflow-hidden rounded-[2px] text-center text-[0.5rem] uppercase leading-[0.875rem] tracking-wider text-foreground/45 transition-colors hover:text-foreground ${
        // Preseason is a fortnight against the regular season's four months, so
        // it is the brighter of the two — at that width a dimmer fill would
        // read as a rendering artefact rather than a marker.
        marker.kind === "preseason"
          ? "bg-foreground/20 hover:bg-foreground/30"
          : "bg-foreground/10 hover:bg-foreground/20"
      }`}
    >
      {marker.chip}
    </button>
  );
}

/**
 * The NFL draft, as an instant. It is the one marker that isn't a span and the
 * one that doesn't take the accent: the accent is what the *selection* is, and a
 * fixed date wearing it would read as part of the window. It is labelled rather
 * than left as a bare glyph, so the rail needs no legend.
 */
function DraftFlag({
  marker,
  position,
  onSelect,
}: {
  marker: NflMarker;
  position: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${marker.label} — start the window here`}
      aria-label={`Start the window at the ${marker.label}`}
      style={{ left: `${position}%` }}
      className="absolute inset-y-0 flex items-center gap-1 whitespace-nowrap pl-1 text-[0.5rem] uppercase tracking-wider text-fuchsia-300/70 transition-colors hover:text-fuchsia-200"
    >
      <span
        aria-hidden="true"
        className="absolute -left-[3px] h-1.5 w-1.5 rotate-45 rounded-[1px] bg-fuchsia-400"
      />
      Draft
    </button>
  );
}
