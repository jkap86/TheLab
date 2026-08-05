"use client";

import { useMemo, useRef, useState } from "react";

import {
  type AdpRange,
  boardLabel,
  formatRangeDate,
  formatRangeMonth,
  rangeBounds,
  rangeSummary,
} from "../adp-controls";
import { draftAnchor, lookbackRange, lookbackView, sinceDraftRange } from "../lookback";
import {
  type MonthBar,
  densityThrough,
  drawnBounds,
  fractionOf,
  monthBars,
  monthExtent,
  scrubDomain,
} from "../range-domain";

/**
 * The window at rest: the density at a glance, with nothing to grab.
 *
 * It exists because the full control is behind a press, and the argument for
 * showing the drafts in the first place was that they answer *where the market
 * is* before you choose a window — an answer given only after a press is an
 * answer given too late. So the resting line carries a hint of it: the same
 * bars, the same domain, lit inside the window and dim outside it.
 *
 * It is drawn by calling the same functions the panel's channel calls rather
 * than by being handed measurements, so the two cannot disagree about where a
 * month sits — and it takes no props the panel doesn't.
 *
 * `aria-hidden`, because it is a picture of what the row beside it already says
 * in words, and the control it previews is one press away and reachable.
 */
export function RangeSparkline({
  months,
  live,
  today,
  bounds,
  className = "",
}: {
  months: readonly MonthBar[];
  live: boolean;
  today: string;
  bounds: { from: string | null; to: string | null };
  className?: string;
}) {
  const domain = useMemo(
    () => scrubDomain(months, densityThrough(months, today, live)),
    [months, today, live],
  );
  const bars = useMemo(() => monthBars(months, domain), [months, domain]);
  const peak = bars.reduce((max, b) => Math.max(max, b.drafts), 0);

  const drawn = drawnBounds(bounds, domain);
  const left = fractionOf(domain, drawn.from) * 100;
  const right = fractionOf(domain, drawn.to) * 100;

  return (
    <span aria-hidden className={`relative block overflow-hidden ${className}`}>
      {bars.map((bar) => {
        if (bar.drafts === 0) return null;
        const { left: barLeft, width } = monthExtent(bar.month, domain);
        const touched =
          bar.month >= drawn.from.slice(0, 7) && bar.month <= drawn.to.slice(0, 7);
        return (
          <span
            key={bar.month}
            style={{
              left: `${barLeft * 100}%`,
              width: `calc(${width * 100}% - 1px)`,
              height: `${Math.max(12, (bar.drafts / peak) * 100)}%`,
            }}
            className={`absolute bottom-0 rounded-t-[1px] ${
              touched ? "bg-active/45" : "bg-foreground/15"
            }`}
          />
        );
      })}
      {/* The window itself, in case the bars can't say it — a narrow window over
          a quiet stretch lights nothing, and "no bars lit" and "nothing selected"
          must not look the same. */}
      <span
        style={{ left: `${left}%`, width: `${right - left}%` }}
        className="absolute bottom-0 h-px bg-active/70"
      />
    </span>
  );
}

/**
 * The ADP board's window as a sentence: **last N days, ending on a date that
 * defaults to today** — a counter instrument in place of the brush this
 * replaced.
 *
 * The brush asked you to place two handles on a strip, and owning that well
 * cost a gesture grammar (drag, sweep, pan, slop, proximity routing) that read
 * as an instrument needing a manual. The counter asks the question in the
 * units readers actually hold it in — "how far back should the average reach"
 * — and the everyday case touches one number. What it deliberately keeps from
 * the brush is the argument, not the gestures:
 *
 *   - **The density stays on screen**, demoted from a control to a readout: the
 *     same bars in a milled channel (`.lab-channel`), lit inside the window,
 *     with the window's own edges ticked over them. It is still never narrowed
 *     by the drawer's other filters — a readout that reshaped under the hand
 *     using the filters beside it would be worse than none — and it still
 *     shows no count, because the bars and the board's population differ and
 *     the header states the real one.
 *   - **"Since the NFL draft" survives as a computed key.** The date moves
 *     every April, so no typed number and no fixed chip can carry it; the ◆
 *     key fills the lens with the day count and pins the stored window at the
 *     draft itself (`sinceDraftRange`), so it doesn't drift with the calendar.
 *   - **The number previews and the release commits** — the steepness slider's
 *     own rule. A committed window re-fetches the board, so typing "104" must
 *     not fetch three boards; the channel and caption re-read per keystroke
 *     (local and free), and the store moves on blur or Enter. The ± keys and
 *     every chip commit at once, since a press is a finished value.
 *
 * All the meaning lives in `lookback.ts` (which storage a write lands in, what
 * the lenses show, which draft the key means); this file lays out pixels and
 * routes input events.
 */
export function LookbackPanel({
  range,
  season,
  bounds,
  months,
  live,
  error,
  loading,
  today,
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
  /** The density read failed; the channel degrades to an empty slot. */
  error: string | null;
  loading: boolean;
  /** `YYYY-MM-DD`. */
  today: string;
  onChange: (range: AdpRange) => void;
}) {
  const root = useRef<HTMLDivElement>(null);

  const domain = useMemo(
    () => scrubDomain(months, densityThrough(months, today, live)),
    [months, today, live],
  );
  const bars = useMemo(() => monthBars(months, domain), [months, domain]);
  const peak = bars.reduce((max, b) => Math.max(max, b.drafts), 0);

  const view = lookbackView(range, today);
  const anchor = useMemo(() => draftAnchor(domain, view.end), [domain, view.end]);

  // The day count being typed, held locally until the field is left — see the
  // preview/commit rule in the component doc. `editing` is what distinguishes
  // "the field is empty mid-edit" from "nothing is being edited".
  const [editing, setEditing] = useState(false);
  const [draftDays, setDraftDays] = useState<number | null>(null);
  // The date input's echo while it holds a partial entry: a controlled date
  // input that snaps back on every incomplete value fights the keyboard, so
  // the transient string stays local and only a full valid date commits.
  const [dateDraft, setDateDraft] = useState<string | null>(null);

  const shown = editing ? { days: draftDays, end: view.end } : { days: view.days, end: view.end };
  // What the channel and caption describe: the draft under the fingers when
  // there is one, the committed range otherwise.
  const previewRange = editing ? lookbackRange(draftDays, view.end, today) : range;
  const previewBounds = editing ? rangeBounds(previewRange, today) : bounds;
  const drawn = drawnBounds(previewBounds, domain);
  const left = fractionOf(domain, drawn.from) * 100;
  const right = fractionOf(domain, drawn.to) * 100;

  const commit = (days: number | null, end: string) =>
    onChange(lookbackRange(days, end, today));

  const step = (delta: number) => {
    // Stepping down from "whole season" would jump to a one-day board, which
    // is nobody's next question — the key simply doesn't count below a count.
    if (shown.days === null && delta < 0) return;
    const next = Math.min(999, Math.max(1, (shown.days ?? 0) + delta));
    commit(next, shown.end);
  };

  const onDraft = anchor !== null && previewBounds.from === anchor.date;
  const summary =
    previewRange.preset === "custom" ? null : rangeSummary(previewRange, today);

  return (
    <div
      ref={root}
      role="group"
      aria-label="Board window"
      className="relative flex flex-col gap-2.5"
      // The face answers a pointer with a glint that tracks it — machined metal
      // catching a light, not a hover state. CSS variables set straight on the
      // element so a pointer move costs no render; a finger gets the face at
      // rest, since it leaves no pointer behind to answer.
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || root.current === null) return;
        const rect = root.current.getBoundingClientRect();
        root.current.style.setProperty("--glint-x", `${(((e.clientX - rect.left) / rect.width) * 100).toFixed(1)}%`);
        root.current.style.setProperty("--glint-y", `${(((e.clientY - rect.top) / rect.height) * 100).toFixed(1)}%`);
        root.current.style.setProperty("--glint-o", "1");
      }}
      onPointerLeave={() => root.current?.style.setProperty("--glint-o", "0")}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -inset-y-1 rounded-md transition-opacity duration-300"
        style={{
          background:
            "radial-gradient(220px 150px at var(--glint-x, 30%) var(--glint-y, 0%), rgba(255,255,255,0.055), transparent 70%)",
          opacity: "var(--glint-o, 0)",
        }}
      />
      {/* The accent rail down the leading face — the manager plate's mark for
          "a readout follows", at panel scale. */}
      <span
        aria-hidden
        className="absolute -left-3 bottom-[12%] top-[12%] w-[3px] rounded-full bg-[linear-gradient(180deg,transparent,rgba(0,255,229,0.7)_30%,rgba(0,255,229,0.7)_70%,transparent)] shadow-[0_0_10px_rgba(0,255,229,0.4)]"
      />

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex items-start gap-1.5">
          <StepKey label="One day less" onClick={() => step(-1)}>
            −
          </StepKey>
          <label className="flex flex-col items-center gap-1">
            <span
              className={`lab-readout lab-lens block h-[46px] w-[92px] rounded-lg transition-shadow ${
                editing ? "lab-readout-live" : ""
              }`}
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                placeholder="—"
                aria-label="Days back — empty means the whole season"
                value={shown.days ?? ""}
                onFocus={() => {
                  setDraftDays(view.days);
                  setEditing(true);
                }}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const parsed = parseInt(raw, 10);
                  setDraftDays(
                    raw === "" || !Number.isFinite(parsed)
                      ? null
                      : Math.min(999, Math.max(1, parsed)),
                  );
                }}
                onBlur={() => {
                  setEditing(false);
                  if (draftDays !== view.days) commit(draftDays, view.end);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                // The lens lights on focus (`lab-readout-live`, driven by
                // `editing`), which is the visible indicator this replaced its
                // outline with — but that state is set by `onFocus` and a
                // `focus-visible` ring costs nothing beside it, so a keyboard
                // reader gets the same mark as everywhere else in the drawer.
                className="h-full w-full bg-transparent text-center font-display text-[1.35rem] font-bold tabular-nums text-active [appearance:textfield] [text-shadow:0_0_14px_rgba(0,255,229,0.45)] placeholder:font-normal placeholder:text-foreground/25 placeholder:[text-shadow:none] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </span>
            <LensUnit>Days back</LensUnit>
          </label>
          <StepKey label="One day more" onClick={() => step(1)}>
            +
          </StepKey>
        </div>

        <div className="flex items-start gap-2">
          <label className="flex flex-col items-center gap-1">
            <span className="lab-readout lab-lens flex h-[46px] items-center rounded-lg px-1">
              <input
                type="date"
                min={domain.from}
                max={today}
                aria-label="Window ends"
                value={dateDraft ?? view.end}
                onChange={(e) => {
                  const value = e.target.value;
                  setDateDraft(value);
                  // Commit only a whole date the window can end on; the years a
                  // keyboard passes through on its way to one stay local.
                  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today && value >= "2000-01-01") {
                    commit(shown.days, value);
                  }
                }}
                onBlur={() => setDateDraft(null)}
                // Unlike the day counter beside it this lens does not light on
                // focus, so removing the outline left it with nothing at all.
                className="bg-transparent px-2 font-display text-[0.68rem] font-bold tabular-nums text-active [color-scheme:dark] [text-shadow:0_0_10px_rgba(0,255,229,0.4)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active"
              />
            </span>
            <LensUnit>Ending</LensUnit>
          </label>

          <span className="mt-[11px] flex flex-wrap gap-1.5">
            <PanelKey
              on={view.endsToday}
              label="End the window today and keep it rolling forward"
              onClick={() => commit(shown.days, today)}
            >
              Today
            </PanelKey>
            {anchor !== null && (
              <PanelKey
                on={onDraft}
                label={`Start the window at the ${anchor.label}`}
                onClick={() => onChange(sinceDraftRange(anchor.date, view))}
              >
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rotate-45 rounded-[1px] bg-fuchsia-400 shadow-[0_0_5px_rgba(232,121,249,0.7)]"
                />
                Draft
              </PanelKey>
            )}
          </span>
        </div>
      </div>

      {/* The density, standing in a milled slot. A readout, not a control: the
          window's edges are ticked over it and the draft keeps its hairline,
          but nothing here catches a drag — the flag is the one press. */}
      <div className="lab-channel relative h-[54px] rounded-md">
        {bars.map((bar) => {
          if (bar.drafts === 0) return null;
          const { left: barLeft, width } = monthExtent(bar.month, domain);
          const coverage = monthCoverage(bar.month, drawn);
          return (
            <div
              key={bar.month}
              title={`${formatRangeMonth(bar.month)} — ${bar.drafts} crawled draft${
                bar.drafts === 1 ? "" : "s"
              }`}
              style={{
                left: `${barLeft * 100}%`,
                width: `calc(${width * 100}% - 1px)`,
                height: `${Math.max(8, (bar.drafts / peak) * 72)}%`,
              }}
              className={`absolute bottom-[6px] rounded-t-[2px] transition-colors ${
                coverage === "out" ? "lab-channel-bar" : "lab-channel-bar-lit"
              } ${coverage === "part" ? "opacity-60" : ""}`}
            />
          );
        })}

        {/* Outside the window the cut goes dark, so the lit bars read as the
            selection even across a quiet month with no bar to light. */}
        <div
          style={{ width: `${left}%` }}
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-[rgba(2,8,13,0.55)] transition-[width] duration-150"
        />
        <div
          style={{ width: `${100 - right}%` }}
          className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md bg-[rgba(2,8,13,0.55)] transition-[width] duration-150"
        />

        {previewBounds.from !== null && (
          <span
            style={{ left: `${left}%` }}
            className="pointer-events-none absolute inset-y-[3px] w-px -translate-x-1/2 bg-active/85 shadow-[0_0_8px_rgba(0,255,229,0.8)]"
          />
        )}
        {previewBounds.to !== null && (
          <span
            style={{ left: `${right}%` }}
            className="pointer-events-none absolute inset-y-[3px] w-px -translate-x-1/2 bg-active/85 shadow-[0_0_8px_rgba(0,255,229,0.8)]"
          />
        )}

        {anchor !== null && (
          <>
            <span
              style={{ left: `${fractionOf(domain, anchor.date) * 100}%` }}
              className="pointer-events-none absolute inset-y-[4px] w-px -translate-x-1/2 bg-fuchsia-400/50"
            />
            <button
              type="button"
              title={`${anchor.label} — start the window here`}
              aria-label={`Start the window at the ${anchor.label}`}
              onClick={() => onChange(sinceDraftRange(anchor.date, view))}
              style={{ left: `${fractionOf(domain, anchor.date) * 100}%` }}
              className={`absolute -top-[5px] h-[10px] w-[10px] -translate-x-1/2 rotate-45 rounded-[2px] bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.8),inset_0_1px_0_rgba(255,255,255,0.5)] transition-shadow hover:shadow-[0_0_13px_rgba(232,121,249,1),inset_0_1px_0_rgba(255,255,255,0.6)] focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-300 ${
                onDraft ? "outline outline-1 outline-offset-[3px] outline-fuchsia-400/70" : ""
              }`}
            />
          </>
        )}
      </div>

      <p className="flex flex-wrap items-baseline gap-x-1.5 text-[0.7rem] tabular-nums text-foreground/45">
        <span className="font-semibold text-active">
          {boardLabel(previewRange, season)}
        </span>
        {summary !== null && <span className="text-foreground/40">{summary}</span>}
        {view.endsToday && shown.days !== null && (
          <span className="text-foreground/30">· rolls forward daily</span>
        )}
        {!view.endsToday && (
          <span className="text-foreground/30">· ends {formatRangeDate(view.end)}</span>
        )}
        {error ? (
          <span className="text-foreground/30">· draft activity unavailable</span>
        ) : peak === 0 && !loading ? (
          <span className="text-foreground/30">
            · no crawled drafts {season === "all" ? "to chart" : `for ${season}`}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * How much of a month the drawn window covers — which of the channel's two bar
 * materials it wears, and whether at full strength. Presentation only: the
 * *meaning* of the window lives in `lookback.ts`, this is about pixels.
 */
function monthCoverage(
  month: string,
  drawn: { from: string; to: string },
): "in" | "part" | "out" {
  const start = `${month}-01`;
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  if (end < drawn.from || start > drawn.to) return "out";
  return start >= drawn.from && end <= drawn.to ? "in" : "part";
}

/** A square keycap — the ± steps, sized to sit centred on the lens beside it. */
function StepKey({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="lab-chip mt-[8px] grid h-[30px] w-[30px] place-items-center rounded-lg text-[0.95rem] font-semibold text-foreground/75 transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** The unit engraved under a lens, the countdown cells' own habit. */
function LensUnit({ children }: { children: string }) {
  return (
    <span className="text-[0.5rem] font-bold uppercase tracking-[0.22em] text-foreground/35 [text-shadow:0_-1px_0_rgba(0,0,0,0.85),0_1px_0_rgba(255,255,255,0.06)]">
      {children}
    </span>
  );
}

/** A small raised key, `.lab-chip` in its half-thickness spelling. */
function PanelKey({
  on,
  label,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`lab-chip lab-chip-sm flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[0.66rem] font-semibold transition-colors ${
        on ? "lab-chip-on" : "text-foreground/70"
      }`}
    >
      {children}
    </button>
  );
}
