"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AdpRange,
  boardLabel,
  formatRangeDate,
  formatRangeMonth,
  rangeSummary,
  shiftDays,
} from "../adp-controls";
import { type NflMarker, nflMarkersIn } from "../nfl-calendar";
import {
  type MonthBar,
  type ScrubDomain,
  type ScrubTarget,
  axisTicks,
  dateAtFraction,
  daysBetween,
  densityThrough,
  drawnBounds,
  edgeBounds,
  fractionOf,
  monthBars,
  monthExtent,
  panWindow,
  scrubDomain,
  scrubTargetAt,
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
 * Four things about it are decisions rather than styling:
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
 *   - **The gesture depends on where it starts** — the standard brush split.
 *     Inside the window drags the window; outside it draws a new one. Which
 *     means a *press* has to be able to mean nothing at all: see `SWEEP_SLOP`.
 *
 * All the maths is in `range-domain`; this file lays out pixels and handles
 * pointers. `today` is passed in rather than read from the clock, so the domain
 * only changes when the date does.
 */
export function RangeScrubber({
  range,
  season,
  bounds,
  months,
  live,
  error,
  loading,
  today,
  presets,
  onChange,
}: {
  range: AdpRange;
  /** The season these drafts are for — `"all"` when the board pools every one. */
  season: string;
  /** The range resolved against today — a preset's dates, or the custom pair. */
  bounds: { from: string | null; to: string | null };
  /** Crawled drafts per month, already cut to `season` by the caller. */
  months: readonly MonthBar[];
  /** Drafts for this board are still being run, so the axis runs to today. */
  live: boolean;
  /** The density read failed; the strip degrades to a bare axis. */
  error: string | null;
  loading: boolean;
  /** `YYYY-MM-DD`. */
  today: string;
  /**
   * The window presets, rendered at the end of the caption rather than in a
   * labelled row of their own. They fly the handles, so they belong on the line
   * that reports where the handles are — and the row they used to occupy was a
   * label column and a full-height segment strip for three chips.
   */
  presets?: ReactNode;
  onChange: (range: AdpRange) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  // Where the pointer is over the strip, as a date. It drives the readout
  // bubble and the crosshair — the answer to "what is this bar" was previously
  // only available by dragging a handle onto it and reading the caption.
  const [cursor, setCursor] = useState<{ date: string; fraction: number } | null>(null);
  // What the pointer is doing, as state rather than off the ref the gesture's
  // own data lives in: it decides how the window and the bubble are drawn, and
  // a ref read during render is a frame behind whatever set it.
  const [gesture, setGesture] = useState<Drag["mode"] | null>(null);
  // What a press *would* do where the pointer is now. It drives the cursor and
  // lights the handle under it — with the parts no longer catching their own
  // events (see `onPointerDown`), `:hover` can't answer this and the reader
  // would otherwise have no warning of which gesture they are about to start.
  const [hover, setHover] = useState<ScrubTarget | null>(null);

  const domain = useMemo(
    () => scrubDomain(months, densityThrough(months, today, live)),
    [months, today, live],
  );
  const bars = useMemo(() => monthBars(months, domain), [months, domain]);
  const ticks = useMemo(() => axisTicks(bars, domain), [bars, domain]);
  const markers = useMemo(() => nflMarkersIn(domain.from, domain.to), [domain]);
  const peak = bars.reduce((max, b) => Math.max(max, b.drafts), 0);

  const drawn = drawnBounds(bounds, domain);
  const left = fractionOf(domain, drawn.from) * 100;
  const right = fractionOf(domain, drawn.to) * 100;

  // A band clipped to a sliver by the domain's edge is a neighbouring season's
  // tail, not a marker: on a season-scoped axis the left edge *is* a season
  // boundary, so the last four days of the previous regular season arrive as a
  // 2px chip reading "R". Clipping a partly-visible span is still right — it
  // really did run through the months on screen — but below a couple of percent
  // there is nothing left to read, and the draft is exempt because an instant
  // has no width to lose.
  const drawable = (marker: NflMarker) =>
    marker.kind === "draft" ||
    fractionOf(domain, marker.to) - fractionOf(domain, marker.from) >= MIN_BAND_FRACTION;

  const commit = (from: string, to: string) =>
    onChange(edgeBounds(from < to ? from : to, from < to ? to : from, domain));

  /** Where a pointer is, as a fraction of the track. */
  const fractionAt = (clientX: number): number | null => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return (clientX - rect.left) / rect.width;
  };

  /** Whole days a horizontal pixel distance covers on this domain. */
  const daysAcross = (dx: number): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.round((dx / rect.width) * daysBetween(domain.from, domain.to));
  };

  const start = (e: ReactPointerEvent, next: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = next;
    setGesture(next.mode);
    // Captured on the track, which is also the only thing listening — the move
    // and up events keep arriving once the pointer has left the strip entirely,
    // which a drag toward either end does within a few pixels.
    track.current?.setPointerCapture(e.pointerId);
  };

  /**
   * What a pointer at this position would do — the whole gesture split, decided
   * in one place.
   *
   * It used to be decided by *which element was hit*: the handles and the window
   * caught their own presses and everything else fell through to the track as a
   * sweep. That made the drawn mark the target, and a 7px mark is not a target a
   * finger can hit — so on a phone, reaching for a handle collapsed the window
   * to the day under the finger instead. `scrubTargetAt` decides by proximity
   * instead, which is why the parts below are `pointer-events-none`.
   *
   * The radius is read off **the pointer that is actually being used** rather
   * than a `(pointer: coarse)` query: a laptop with a touchscreen is both, and
   * the event already knows which one this press is. It also needs no state, so
   * nothing about it can differ between the server and the first client render.
   */
  const targetAt = (e: ReactPointerEvent): ScrubTarget | null => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return scrubTargetAt(
      e.clientX - rect.left,
      rect.width,
      { from: left / 100, to: right / 100 },
      e.pointerType === "mouse" ? MOUSE_GRAB_PX : TOUCH_GRAB_PX,
    );
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const target = targetAt(e);
    const fraction = fractionAt(e.clientX);
    if (target === null || fraction === null) return;
    if (target === "pan") {
      start(e, { mode: "pan", startX: e.clientX, origin: drawn });
    } else if (target === "sweep") {
      // Far from both handles is an intent to reselect, not to nudge the nearer
      // end: "nearest handle always wins" makes a short window impossible to
      // draw from scratch.
      start(e, {
        mode: "sweep",
        anchor: dateAtFraction(domain, fraction),
        startX: e.clientX,
        moved: false,
      });
    } else {
      start(e, { mode: target });
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const fraction = fractionAt(e.clientX);
    if (fraction === null) return;
    const date = dateAtFraction(domain, fraction);
    setCursor({ date, fraction });

    const active = drag.current;
    if (!active) {
      setHover(targetAt(e));
      return;
    }
    if (active.mode === "pan") {
      const moved = panWindow(active.origin, daysAcross(e.clientX - active.startX), domain);
      onChange(edgeBounds(moved.from, moved.to, domain));
    } else if (active.mode === "sweep") {
      // A tap is not a selection. Without this the lightest press anywhere on
      // the strip collapses the window to the single day under the finger —
      // which on a phone is what "I meant to scroll" looks like.
      if (!active.moved && Math.abs(e.clientX - active.startX) < SWEEP_SLOP) return;
      active.moved = true;
      commit(active.anchor, date);
    } else if (active.mode === "from") {
      commit(date, drawn.to);
    } else {
      commit(drawn.from, date);
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    drag.current = null;
    setGesture(null);
    // A finger leaves nothing hovering behind it, so lighting a handle after it
    // lifts would be a control reporting a pointer that isn't there.
    setHover(e.pointerType === "mouse" ? targetAt(e) : null);
    // A finger leaves no cursor behind it; a mouse does, and the bubble under it
    // is still the answer to "what date is this bar".
    if (e.pointerType !== "mouse") setCursor(null);
  };

  const nudge = (mode: "from" | "to", days: number) => {
    const date = shiftDays(mode === "from" ? drawn.from : drawn.to, days);
    if (mode === "from") commit(date, drawn.to);
    else commit(drawn.from, date);
  };

  // The bubble follows the pointer while a handle is being drawn or a window
  // swept, and the hovering pointer otherwise. Panning is the exception: both
  // ends are moving, so the caption's live pair says more than one date would.
  const bubble = cursor !== null && gesture !== "pan" ? cursor : null;
  // The dates behind a preset's name, which the name deliberately doesn't say —
  // a custom range's label already *is* its dates, so it gets the span instead.
  const summary = range.preset === "custom" ? null : rangeSummary(range, today);
  const bounded = bounds.from !== null || bounds.to !== null;
  const spanDays = daysBetween(drawn.from, drawn.to) + 1;

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          if (drag.current) return;
          setCursor(null);
          setHover(null);
        }}
        className={`relative h-14 touch-none select-none rounded-sm border-b border-foreground/10 ${
          CURSORS[gesture ?? hover ?? "sweep"]
        }`}
      >
        {bars.map((bar) => {
          const { left: barLeft, width } = monthExtent(bar.month, domain);
          if (bar.drafts === 0) return null;
          // Any overlap with the window, not containment: a bar is a whole
          // month and the window cuts through one at each end, so the scrim is
          // what says how much of it counts — this only separates the months
          // the window reaches from the ones it doesn't.
          const touched =
            bar.month >= drawn.from.slice(0, 7) && bar.month <= drawn.to.slice(0, 7);
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
              className={`absolute bottom-0 rounded-t-[2px] transition-colors ${
                touched ? "bg-active/30" : "bg-foreground/20"
              }`}
            />
          );
        })}

        {/* Everything outside the window is dimmed rather than the inside being
            brightened, so the bars keep one weight and the selection reads as a
            window cut in the panel. */}
        <div
          style={{ width: `${left}%` }}
          className="pointer-events-none absolute inset-y-0 left-0 bg-[rgb(12,23,33)]/65"
        />
        <div
          style={{ width: `${100 - right}%` }}
          className="pointer-events-none absolute inset-y-0 right-0 bg-[rgb(12,23,33)]/65"
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

        {cursor !== null && !gesture && (
          <div
            style={{ left: `${cursor.fraction * 100}%` }}
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/35"
          />
        )}

        {/* The window is still the pan target, but the *track* routes the press
            to it — so this is paint, not a hit area, and it must not swallow a
            press aimed at a handle a few pixels inside it. */}
        <div
          aria-hidden
          style={{ left: `${left}%`, width: `${right - left}%` }}
          className={`pointer-events-none absolute inset-y-0 border-y border-active/40 transition-colors ${
            gesture === "pan"
              ? "bg-active/[0.14]"
              : hover === "pan"
                ? "bg-active/[0.12]"
                : "bg-active/[0.07]"
          }`}
        />

        <Handle
          position={left}
          side="from"
          label="Window start"
          value={drawn.from}
          open={bounds.from === null}
          domain={domain}
          lit={gesture === "from" || (!gesture && hover === "from")}
          onNudge={(days) => nudge("from", days)}
        />
        <Handle
          position={right}
          side="to"
          label="Window end"
          value={drawn.to}
          open={bounds.to === null}
          domain={domain}
          lit={gesture === "to" || (!gesture && hover === "to")}
          onNudge={(days) => nudge("to", days)}
        />

        {bubble !== null && (
          <span
            style={{
              left: `${bubble.fraction * 100}%`,
              // Anchored proportionally rather than centred, so a bubble at
              // either end of the axis stays inside the panel without a
              // measurement: 0% is flush left, 100% flush right.
              transform: `translateX(-${Math.min(100, Math.max(0, bubble.fraction * 100))}%)`,
            }}
            className={`pointer-events-none absolute -top-1.5 whitespace-nowrap rounded-full border px-1.5 py-px text-[0.6rem] tabular-nums shadow-lg ${
              gesture
                ? "border-active/40 bg-active/15 text-active"
                : "border-foreground/15 bg-[rgb(12,23,33)] text-foreground/60"
            }`}
          >
            {formatRangeDate(bubble.date)}
          </span>
        )}
      </div>

      <div className="relative h-3.5">
        {markers.filter(drawable).map((marker) =>
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
        {ticks.map((tick) => (
          <span
            key={tick.month}
            style={{ left: `${tick.left * 100}%`, width: `${tick.width * 100}%` }}
            className={`absolute overflow-hidden text-center ${
              tick.year ? "font-semibold text-foreground/50" : ""
            }`}
          >
            {tick.label}
          </span>
        ))}
      </div>

      <p className="flex flex-wrap items-baseline gap-x-1.5 text-[0.7rem] tabular-nums text-foreground/45">
        <span className="font-semibold text-active">{boardLabel(range, season)}</span>
        {summary !== null && <span className="text-foreground/40">{summary}</span>}
        {/* An unbounded range has no length to report — the strip's own span
            isn't it, since "all time" keeps matching drafts off both ends. */}
        {bounded && (
          <span className="text-foreground/30">
            · {spanDays.toLocaleString()} day{spanDays === 1 ? "" : "s"}
          </span>
        )}
        {error ? (
          <span className="text-foreground/30">· draft activity unavailable</span>
        ) : peak === 0 && !loading ? (
          <span className="text-foreground/30">
            · no crawled drafts {season === "all" ? "to chart" : `for ${season}`}
          </span>
        ) : null}
        {presets !== undefined && (
          <span className="ml-auto flex shrink-0 items-center gap-1">{presets}</span>
        )}
      </p>
    </div>
  );
}

/** How far a press has to travel before it counts as drawing a window. */
const SWEEP_SLOP = 4;

/**
 * How near a handle a press has to land to grab it, in pixels.
 *
 * The touch figure is half of the ~44px target the platforms ask for, measured
 * from the handle rather than around it — which is the same thing, and it works
 * on the domain's edge where a 44px *box* would be half off the panel. The mouse
 * figure is deliberately much smaller: a cursor is precise, and a generous
 * radius there only makes a narrow window hard to pan.
 */
const TOUCH_GRAB_PX = 22;
const MOUSE_GRAB_PX = 9;

/** Say what the press is about to do before it happens. */
const CURSORS: Record<ScrubTarget, string> = {
  from: "cursor-ew-resize",
  to: "cursor-ew-resize",
  pan: "cursor-grab active:cursor-grabbing",
  sweep: "cursor-crosshair",
};

/**
 * Half the grip's width, so a handle sitting on an edge of the domain keeps its
 * whole thumb on the panel. The hairline stays on the date — what moves is the
 * part you hold, which has no business claiming to be a date in the first place.
 */
const GRIP_INSET_PX = 5;

/** Narrower than this and a season band is a rendering artefact, not a marker. */
const MIN_BAND_FRACTION = 0.02;

/** What a pointer is currently doing to the window, and what it needs to do it. */
type Drag =
  | { mode: "from" | "to" }
  | { mode: "sweep"; anchor: string; startX: number; moved: boolean }
  | { mode: "pan"; startX: number; origin: { from: string; to: string } };

/**
 * One end of the window. A real `role="slider"` so it is reachable and nudgeable
 * from the keyboard — the strip is a pointer control first, and a date range
 * that can only be set by dragging isn't a date range everyone can set.
 *
 * **It catches no pointer events.** The track routes every press through
 * `scrubTargetAt`, so this is the mark and the focus target and nothing else —
 * which is exactly what lets the grab area be bigger than the thing drawn, and
 * lets a handle parked on the domain's edge be grabbed from the edge rather than
 * from a box half of which is off the panel. `pointer-events-none` does not stop
 * it being focused, so the keyboard half is untouched.
 *
 * `lit` therefore comes in as a prop: with no pointer events there is no
 * `:hover` to style from, and a handle that doesn't answer the cursor reads as
 * decoration.
 */
function Handle({
  position,
  side,
  label,
  value,
  open,
  domain,
  lit,
  onNudge,
}: {
  /** Percent across the track. */
  position: number;
  side: "from" | "to";
  label: string;
  value: string;
  /** This end is unbounded — the handle is parked on the domain's edge. */
  open: boolean;
  domain: ScrubDomain;
  /** The pointer is on this handle, or dragging it. */
  lit: boolean;
  onNudge: (days: number) => void;
}) {
  // Nudged inward on the domain's edges so the whole grip stays on the panel.
  // Only the grip moves — the hairline keeps the date, which is the one thing
  // here that is a claim about the data rather than something to hold.
  const inset =
    position <= 0 ? GRIP_INSET_PX : position >= 100 ? -GRIP_INSET_PX : 0;

  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={daysBetween(domain.from, domain.to)}
      aria-valuenow={daysBetween(domain.from, value)}
      // An open end is a different claim from a bound one sitting on the same
      // day, and it is the handle's whole subtlety — so the screen reader is
      // told which it is rather than being read the edge date.
      aria-valuetext={open ? `${formatRangeDate(value)}, open` : formatRangeDate(value)}
      style={{ left: `${position}%` }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 7 : 1;
        if (e.key === "ArrowLeft") onNudge(-step);
        else if (e.key === "ArrowRight") onNudge(step);
        else if (e.key === "PageDown") onNudge(-30);
        else if (e.key === "PageUp") onNudge(30);
        else return;
        e.preventDefault();
      }}
      className="group pointer-events-none absolute -top-2 -bottom-2 -ml-3 w-6 focus:outline-none"
    >
      <span className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-active/70" />
      <span
        style={{ transform: `translate(calc(-50% + ${inset}px), -50%)` }}
        className={`absolute top-1/2 left-1/2 h-7 w-[9px] bg-active transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-active/60 group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-[rgb(12,23,33)] ${
          lit
            ? "shadow-[0_0_12px_rgba(0,255,229,0.9)]"
            : "shadow-[0_0_8px_rgba(0,255,229,0.45)]"
        } ${
          // Rounded away from the window on the outside edge only, so the pair
          // reads as brackets around the selection rather than two pills.
          side === "from" ? "rounded-l-full rounded-r-[1px]" : "rounded-r-full rounded-l-[1px]"
        }`}
      />
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
  domain: ScrubDomain;
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
 *
 * The label flips to the left of its mark in the last quarter of the axis. It
 * is the only marker whose text isn't bounded by its own extent, so near the
 * right edge it was the one thing that could run off the panel — and a draft
 * three weeks from today sits exactly there for the months that matter most.
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
  const flip = position > 75;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${marker.label} — start the window here`}
      aria-label={`Start the window at the ${marker.label}`}
      style={{ left: `${position}%`, transform: flip ? "translateX(-100%)" : undefined }}
      className={`absolute inset-y-0 z-10 flex items-center whitespace-nowrap rounded-[2px] bg-[rgb(12,23,33)]/80 text-[0.5rem] uppercase tracking-wider text-fuchsia-300/70 transition-colors hover:text-fuchsia-200 ${
        flip ? "pr-1.5" : "pl-1.5"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute h-1.5 w-1.5 rotate-45 rounded-[1px] bg-fuchsia-400 ${
          flip ? "-right-[3px]" : "-left-[3px]"
        }`}
      />
      Draft
    </button>
  );
}
