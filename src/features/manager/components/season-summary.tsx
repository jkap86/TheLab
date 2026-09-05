import type { ManagerLeague } from "@/shared/contract";

import {
  formatCombinedRecord,
  formatWinPct,
  seasonSummary,
} from "../helpers/season-summary";

/**
 * The season's figures, mounted on the identity plate: two engraved counts and
 * a gauge.
 *
 * **It used to be a housing of its own** — a two-row ledger beside a 112px dial,
 * standing next to the plate on the header row. The merge is the header pass:
 * the manager's name and how their season is going are one statement about one
 * person, and four instruments on one row were four boxes saying it. So this is
 * no longer a surface; it is the right-hand half of `ManagerPlate`'s engraving,
 * mounted through that component's `children` seam.
 *
 * The split inside it survives the merge, because it was never about the boxes.
 * Leagues and the combined record are *counts* — they are engraved figures under
 * etched labels, and the eye compares them to nothing. The win rate is a
 * *proportion*, so it keeps the instrument: a dial whose arc is the number, with
 * the figure repeated in a lit window at the centre because an arc alone cannot
 * be read to a decimal.
 *
 * **What went with the housing.** The Games line — `182 games · no ties` — came
 * off the plate: it is the win rate's denominator rather than a reading of its
 * own, and `summary.games` is still what the rate is taken over. And the dial
 * stepped down from 112px to 88px, because it now shares a plate with a 2rem
 * engraved name rather than standing beside one.
 *
 * Everything here is taken over the **filtered** list — see {@link seasonSummary},
 * which reverses what it used to say, and {@link SeasonSummary.total} for the
 * one figure that is not.
 *
 * **Below `sm` this block has no box.** It is `display: contents`, and its four
 * readings become items of the plate's own compact strip so the Filters key can
 * be ordered in beside `Leagues` — see `ManagerPlate`'s `compactStrip` for why
 * that is one row rather than two, and for why the key is one element ordered
 * rather than two elements with one hidden. What that costs here is an
 * `order-*` on each reading and a `sm:order-none` beside it; what it buys is a
 * plate half its former height on a phone.
 *
 * The dial steps 88px → 72px with it and every inset steps with the dial, which
 * is a chain rather than a set of independent numbers: the arc, the pointer and
 * the lit window are all measured from the bezel's own edge, and the innermost
 * of them is what the percentage has to fit inside.
 */
export function SeasonSummary({
  leagues,
  total,
  narrowing,
}: {
  /** The list as the reader has narrowed it — what every figure is taken over. */
  leagues: readonly ManagerLeague[];
  /** Every league on the account, for the denominator below. */
  total: number;
  /** Whether any narrowing is in force — see the Leagues field. */
  narrowing: boolean;
}) {
  const summary = seasonSummary(leagues);
  const pct = formatWinPct(summary);
  // The dial's arc. Null (no league has a record yet) draws an empty track
  // rather than a zero-length arc at the top, which would read as 0%.
  const degrees = summary.winPct === null ? 0 : (summary.winPct / 100) * 360;

  return (
    // `ml-auto` above `sm` puts the season at the plate's far end, against the
    // name at its near one.
    //
    // **Below `sm` this block has no box at all.** It is `display: contents`, so
    // the four readings below become items of the plate's own compact strip and
    // can be ordered among the controls that share it — see `ManagerPlate`'s
    // `compactStrip`, which is what draws the milled cut this used to sit under.
    // Every `order-*` here is the phone arrangement, and every `sm:order-none`
    // hands the row back to DOM order at the breakpoint.
    <div className="contents sm:ml-auto sm:flex sm:w-auto sm:items-stretch sm:gap-4">
      {/* The groove that separates the name from the season. It is drawn here
          rather than by the plate because it belongs to this block: on a
          wrapped line it would be a stub hanging off the left edge, so below
          `sm` there is nothing to separate and it does not exist. */}
      <Groove className="hidden sm:block" />

      {/*
        **The denominator appears exactly when it means something.** Unfiltered,
        the figure is one number and reads as the account. Narrowed, `9 / 14` is
        what stops "Leagues 9" from claiming to be the whole account to anyone
        who did not set the filter — which is the readout the View housing used
        to carry and the reason the plate had to take it over when that housing
        moved into the rack.
      */}
      <Figure label="Leagues" className="order-1 sm:order-none">
        {narrowing ? `${summary.leagues} / ${total}` : String(total)}
      </Figure>

      {/* Below `sm` the Filters key sits between these two, at `order-2`, with
          **no groove before it**: the count and the key that narrows it are one
          reading, and a milled channel between them would say they are two.
          The groove that separates the pair from the record is this one. */}
      <Groove className="order-3 sm:order-none" />

      <Figure label="Record" className="order-4 sm:order-none">
        {formatCombinedRecord(summary)}
      </Figure>

      {/* Gone below `sm`, where the dial is pushed to the strip's far end by
          `ml-auto` instead — a groove is a cut between two things standing
          side by side, and there is nothing beside it once the gap is the
          separation. */}
      <Groove className="hidden sm:block" />

      <div className="order-5 ml-auto flex items-center gap-3 sm:order-none sm:ml-0">
        {/* 72px below `sm` against 88px above it. The inner window is the
            constraint the rest of the dial is measured from — see the readout
            at the bottom of this block. */}
        <div className="relative size-18 shrink-0 rounded-full border border-foreground/10 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)] sm:size-22">
          {/* The arc itself. A conic gradient rather than an SVG ring: the
              angle is the only thing that varies, and it varies per render. */}
          <span
            aria-hidden
            className="absolute inset-[0.3125rem] rounded-full shadow-[inset_0_0_12px_rgba(0,0,0,0.95)] sm:inset-[0.4375rem]"
            style={{
              background: `conic-gradient(var(--accent) 0deg ${degrees}deg, var(--dial-track) ${degrees}deg 360deg)`,
            }}
          />
          {/* The pointer, parked at the end of the arc. Rotating a wrapper and
              pinning the dot to its top edge keeps the maths to one angle. */}
          {summary.winPct !== null && (
            <span
              aria-hidden
              className="absolute inset-[0.3125rem] rounded-full sm:inset-[0.4375rem]"
              style={{ transform: `rotate(${degrees}deg)` }}
            >
              <span className="absolute -top-[0.21875rem] left-1/2 -ml-[0.21875rem] size-[0.4375rem] rounded-full bg-readout shadow-[0_0_12px_var(--accent-glow)] sm:-top-1 sm:-ml-1 sm:size-[0.5625rem]" />
            </span>
          )}
          {/* The lit window at the centre, so the arc can be read exactly. */}
          <div className="absolute inset-[0.75rem] flex flex-col items-center justify-center overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--readout-shadow)] sm:inset-[0.9375rem]">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
            />
            <span className="relative font-mono text-[length:var(--fs-8)] uppercase leading-none tracking-[0.14em] text-readout/60 sm:text-[length:var(--fs-9)] sm:tracking-[0.16em]">
              Win
            </span>
            {/*
              **The inner circle is what sizes this figure**, not the dial, and
              it is a different circle at each width: 46px on the phone dial and
              56px on the desktop one. `100.0%` is the widest reading the page
              can produce — a small account that has won every game — and it is
              what both sizes have to clear.

              On the phone dial `--fs-10` puts it at ~41px inside 46 and needs
              no help at all. The desktop one is the tight case and both of its
              sizes are **measured against the circle rather than against the
              window's width**, which is the trap: a 56px circle is only 56px
              wide across its centre, and a line of digits sitting below the
              `Win` label crosses it on a shorter chord. `--fs-17` clips `53.7%`
              there — an ordinary reading, not the worst one — so five
              characters take `--fs-15` and six take `--fs-12`, which is the
              rule `WeekSummary`'s dial already lives by one tool over, one step
              tighter because this window is 56px against its 62.
            */}
            <span
              className={`relative mt-0.5 font-mono text-[length:var(--fs-10)] leading-none text-readout [text-shadow:var(--readout-text-glow)] ${
                pct.length > 5
                  ? "sm:text-[length:var(--fs-12)]"
                  : "sm:text-[length:var(--fs-15)]"
              }`}
            >
              {pct}
            </span>
          </div>
        </div>
        {/* Dropped below `sm`, where the whole season block has to fit a 332px
            plate: the caption is ~46px of it and the lit window inside the dial
            already reads "WIN 50.0%", so it is the one thing here that says
            something twice. Without it the block measured 311px against 332. */}
        <span className="hidden max-w-16 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/72 sm:inline">
          Win rate
        </span>
      </div>
    </div>
  );
}

/**
 * One engraved figure under its etched label.
 *
 * A `<dl>` per field rather than one list holding both, because the grooves
 * between them are not list content: a definition list may hold only `dt`, `dd`
 * and the `div`s grouping them. One name and one value is exactly what a `<dl>`
 * is for, so two of them is the reading that keeps the semantics without
 * wrapping a milled hairline in a group it does not belong to.
 */
function Figure({
  label,
  children,
  className = "",
}: {
  label: string;
  children: string;
  /** Where it sits in the plate's compact strip — see the block above. */
  className?: string;
}) {
  return (
    <dl className={`m-0 flex flex-col justify-center gap-1 px-0 sm:gap-2 sm:px-4 ${className}`}>
      <dt className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/72 sm:text-[length:var(--fs-11)]">
        {label}
      </dt>
      {/* `nowrap`: the en dash in `8–5` is a line-break opportunity, and a
          record split across two lines reads as two numbers. */}
      <dd className="m-0 whitespace-nowrap font-display text-[length:var(--fs-17)] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[length:var(--fs-26)] sm:tracking-[-0.03em]">
        {children}
      </dd>
    </dl>
  );
}

/** The milled channel between two figures — the plate's own cut, not a rule. */
function Groove({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`my-0.5 w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)] ${className}`}
    />
  );
}
