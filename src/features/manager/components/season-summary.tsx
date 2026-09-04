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
  // The dial's arc. Null (no league has a record yet) draws an empty track
  // rather than a zero-length arc at the top, which would read as 0%.
  const degrees = summary.winPct === null ? 0 : (summary.winPct / 100) * 360;

  return (
    // `ml-auto` above `sm` puts the season at the plate's far end, against the
    // name at its near one. Below `sm` it takes a line of its own — the plate
    // wraps rather than truncating a display name, which is the plate's subject.
    <div className="flex w-full items-stretch gap-3 sm:ml-auto sm:w-auto sm:gap-4">
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
      <Figure label="Leagues">
        {narrowing ? `${summary.leagues} / ${total}` : String(total)}
      </Figure>

      <Groove />

      <Figure label="Record">{formatCombinedRecord(summary)}</Figure>

      <Groove />

      <div className="flex items-center gap-3">
        <div className="relative size-22 shrink-0 rounded-full border border-foreground/10 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)]">
          {/* The arc itself. A conic gradient rather than an SVG ring: the
              angle is the only thing that varies, and it varies per render. */}
          <span
            aria-hidden
            className="absolute inset-[0.4375rem] rounded-full shadow-[inset_0_0_12px_rgba(0,0,0,0.95)]"
            style={{
              background: `conic-gradient(var(--accent) 0deg ${degrees}deg, var(--dial-track) ${degrees}deg 360deg)`,
            }}
          />
          {/* The pointer, parked at the end of the arc. Rotating a wrapper and
              pinning the dot to its top edge keeps the maths to one angle. */}
          {summary.winPct !== null && (
            <span
              aria-hidden
              className="absolute inset-[0.4375rem] rounded-full"
              style={{ transform: `rotate(${degrees}deg)` }}
            >
              <span className="absolute -top-1 left-1/2 -ml-1 size-[0.5625rem] rounded-full bg-readout shadow-[0_0_12px_var(--accent-glow)]" />
            </span>
          )}
          {/* The lit window at the centre, so the arc can be read exactly. */}
          <div className="absolute inset-[0.9375rem] flex flex-col items-center justify-center overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--readout-shadow)]">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
            />
            <span className="relative font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-readout/60">
              Win
            </span>
            <span className="relative mt-0.5 font-mono text-[1.0625rem] leading-none text-readout [text-shadow:var(--readout-text-glow)]">
              {formatWinPct(summary)}
            </span>
          </div>
        </div>
        {/* Dropped below `sm`, where the whole season block has to fit a 332px
            plate: the caption is ~46px of it and the lit window inside the dial
            already reads "WIN 50.0%", so it is the one thing here that says
            something twice. Without it the block measured 311px against 332. */}
        <span className="hidden max-w-16 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60 sm:inline">
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
function Figure({ label, children }: { label: string; children: string }) {
  return (
    <dl className="m-0 flex flex-col justify-center gap-2 px-2 sm:px-4">
      <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
        {label}
      </dt>
      {/* `nowrap`: the en dash in `8–5` is a line-break opportunity, and a
          record split across two lines reads as two numbers. */}
      <dd className="m-0 whitespace-nowrap font-display text-[1.625rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">
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
