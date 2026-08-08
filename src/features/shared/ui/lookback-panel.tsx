"use client";

import { useMemo, useRef, useState } from "react";

import { mobileInputText } from "../control-type.ts";
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
 *   - **Each key is seated under the lens it writes**, which is the one thing
 *     about the row a reader should not have to work out: the window has two
 *     ends and there is a key for each, so `Today` — which moves the *end* —
 *     stands under `Ending`, and the ◆ draft key — which moves the *start* —
 *     stands under `Days back`. Held together in a cluster at the end of the
 *     row they read as two spellings of one thing, and at a phone width, where
 *     the cluster took a line of its own, they sat under neither lens.
 *   - **The number previews and the release commits** — the steepness slider's
 *     own rule. A committed window re-fetches the board, so typing "104" must
 *     not fetch three boards; the channel and caption re-read per keystroke
 *     (local and free), and the store moves on blur or Enter. The ± keys and
 *     every chip commit at once, since a press is a finished value.
 *
 * **It is now the whole of the control, and that is what makes the lenses
 * load-bearing rather than an alternative spelling.** It spent a while behind a
 * press, with a row of relative presets on the line that opened it — so the
 * everyday windows were chips and this was where you went for the rest. Both
 * are gone ({@link AdpRangeControl}), which leaves exactly one path to each of
 * them: "last 30 days" is `30` in the day lens, the whole season is that lens
 * left **empty** (the placeholder is an em dash and the label says so), and a
 * historical cut is the date lens. Anything that removes a way *into* one of
 * those three is removing the only one.
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

      {/* **A key is seated under the lens it moves**, and that pairing is what
          the row is arranged around: `Today` writes the window's *end*, so it
          sits under `Ending`; the ◆ draft key writes its *start*, so it sits
          under `Days back`. They used to be a third peer of the wrap — one
          cluster holding both, at the trailing end — which left a reader to
          work out from two lenses and two keys which key filled which lens,
          and the answer moved with the wrap: at a phone width the pair took a
          line of their own, where neither key was beside anything at all.

          Seating them costs the row **no width**, because a key is narrower
          than the lens above it (the ◆ key measures ~63px under a 64px lens at
          the narrow tier, `Today` ~51px under ~120px), so the two columns are
          the widths the table below measures and the wrap still falls where it
          fell. What it buys back is a line: at a phone width the keys were
          already wrapping onto one, so the panel is *shorter* there, and only
          a drawer wide enough to have held all four on one line pays the key's
          height at all.

          The widths are measured rather than judged, and at every device pixel
          ratio rather than one — the date lens is a **native control**, and its
          width moves ~6px per step of DPR and again with whatever the platform
          makes of a date field. The panel is the viewport below 512, so a 390px
          screen leaves this row 332px and a 360px screen 302px, against 454 for
          a full-width drawer.

          **The date in it is set at 16px now** — the floor below which iOS
          Safari zooms the page on focus, and the reason there is no
          `maximumScale` on the viewport any more (see
          `features/shared/control-type.ts`). That is ~29px of extra glyph, and
          it is paid for entirely out of chrome rather than out of the row: the
          native control's own internal padding and its picker button
          (`.date-field-tight`), the housing's inset, and a hair of negative
          tracking on ten wide glyphs. What the pair actually measures, at
          1× / 2× / 3×:

          | row | budget | before | after |
          | --- | --- | --- | --- |
          | 302 (360px screen) | 302 | 252 / 258 / 264 | 256 / 262 / 268 |
          | 332 (390px screen) | 332 | 252 / 258 / 264 | 256 / 262 / 268 |
          | 454 (full drawer) | 329 | 296 / 302 / 308 | 312 / 318 / 324 |

          — four pixels below `@md` and sixteen above it, both inside the budget
          at every ratio, so **the two columns share one line at every width the
          panel is drawn at**, which is what makes each key's seat under its own
          lens hold rather than being an adjacency the wrap can take away. The
          `flex-wrap` stays for the widths below the ones measured here, and it
          breaks between the lenses — the only seam left, and the one place a
          break costs no pairing. Below `@md` the row still runs compact: the
          housing shrinks, the lens and the two gaps, while every digit stays
          the size it was. */}
      <div className="flex flex-wrap items-start gap-x-2 gap-y-2 @md:gap-x-3">
        <div className="flex items-start gap-1 @md:gap-1.5">
          <StepKey label="One day less" onClick={() => step(-1)}>
            −
          </StepKey>
          <LensColumn
            unit="Days back"
            // The ◆ key fills *this* lens — it moves the window's start, which
            // is what a day count is — so it is seated under it rather than in
            // a cluster of keys at the end of the row. Drawn only where the
            // strip's domain holds a draft.
            seat={
              anchor !== null && (
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
              )
            }
          >
            <span
              className={`lab-readout lab-lens block h-[46px] w-[64px] rounded-lg transition-shadow @md:w-[92px] ${
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
          </LensColumn>
          <StepKey label="One day more" onClick={() => step(1)}>
            +
          </StepKey>
        </div>

        <LensColumn
          unit="Ending"
          // `Today` writes the end date and nothing else — it is this lens's
          // own key, and the one press that re-opens the window so it rolls
          // forward again.
          seat={
            <PanelKey
              on={view.endsToday}
              label="End the window today and keep it rolling forward"
              onClick={() => commit(shown.days, today)}
            >
              Today
            </PanelKey>
          }
        >
          <span className="lab-readout lab-lens flex h-[46px] items-center rounded-lg px-0.5">
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
              // Two things buy back the width 16px costs, and neither is a
              // digit. `.date-field-tight` takes the native control's own
              // internal padding and its picker button; **the button comes back
              // at `@md`**, which is the only tier with room for it and the only
              // one where a mouse is likely — below it the platforms that matter
              // open their picker on a tap anywhere in the field (iOS renders no
              // button at all), so hiding it costs a phone nothing. Restored
              // here rather than in the class because which tier has room is a
              // fact about *this* row, not about date fields.
              //
              // `tracking-[-0.025em]` is the second, and it is width rather than
              // taste: Orbitron is a wide face and this readout is ten glyphs of
              // it, so 0.4px a glyph is 5px of the row — which at `@md`/3× is
              // the whole margin (324 of a 329px budget against 329 without it).
              // Safe against iOS, whose threshold is on `font-size` alone, and
              // `tabular-nums` still aligns since letter-spacing adds uniformly
              // to every advance.
              className={`date-field-tight @md:[&::-webkit-calendar-picker-indicator]:block bg-transparent px-0 font-display ${mobileInputText} font-bold tracking-[-0.025em] tabular-nums text-active [color-scheme:dark] [text-shadow:0_0_10px_rgba(0,255,229,0.4)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active`}
            />
          </span>
        </LensColumn>
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

/**
 * One lens: the housing, the unit engraved under it, and the key that fills it.
 *
 * The key is a **sibling of the `<label>`, never inside it** — a label
 * activates its control, so a button nested in one answers a press by focusing
 * the input beside it, which on the day lens would put the caret in a field the
 * key had just written. It is what the wrapper is for; the two nested columns
 * are the price of that rule, not a stray div.
 *
 * `seat` takes `false` as well as an element so a caller can decline the key
 * inline (the ◆ draft key is drawn only where the strip's domain holds a
 * draft), and the seat is then simply absent — an empty box under a lens would
 * make one column taller than the other for the sake of nothing.
 */
function LensColumn({
  unit,
  seat,
  children,
}: {
  unit: string;
  seat?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <label className="flex flex-col items-center gap-1">
        {children}
        {/* The unit engraved under the lens, the countdown cells' own habit. */}
        <span className="text-[0.5rem] font-bold uppercase tracking-[0.22em] text-foreground/35 [text-shadow:0_-1px_0_rgba(0,0,0,0.85),0_1px_0_rgba(255,255,255,0.06)]">
          {unit}
        </span>
      </label>
      {seat}
    </div>
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
      // The word on the key names the *value* it writes ("Today", "Draft") and
      // the lens above it names the field; the hover is where the sentence is
      // spelled out whole, the contracted player names' own backstop.
      title={label}
      onClick={onClick}
      className={`lab-chip lab-chip-sm flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[0.66rem] font-semibold transition-colors ${
        on ? "lab-chip-on" : "text-foreground/70"
      }`}
    >
      {children}
    </button>
  );
}
