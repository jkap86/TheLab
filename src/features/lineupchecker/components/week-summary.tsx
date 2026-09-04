import type { ReactNode } from "react";

import {
  formatProjectedRecord,
  formatProjectedWinPct,
  type WeekSummary as Summary,
} from "../helpers/week-summary";

/**
 * The week's figures, mounted on the identity plate: the projected record and
 * a dial for the rate it implies, with the attention window beside them.
 *
 * `features/manager/components/season-summary.tsx` with a week's numbers in it,
 * and deliberately the same object — the same groove, the same engraved figure
 * under an etched label, the same conic-gradient dial with the rate repeated in
 * a lit window at its centre. A reader walking from `/manager` to here is
 * looking at one console, and a second dial drawn to hold a proportion would be
 * a second chance for one of them to stop matching.
 *
 * Two things differ, and both follow from the content:
 *
 * - **The inner window is `inset-3` rather than the manager's
 *   `inset-[0.9375rem]`.** The caption beside the dial is `Proj win` where the
 *   manager's is `Win rate`, and the percentage inside clipped against the round
 *   edge at 15px once the label stopped carrying the word.
 * - **Leagues with no opponent are already gone** — `weekSummary` drops them
 *   rather than counting a future week as a loss — so a week with nothing
 *   projected draws an empty track and an em dash, never `0.0%`. That is
 *   `seasonSummary`'s null-is-not-zero rule at a week's grain.
 *
 * It is mounted through `ManagerPlate`'s `children`, which is what switches
 * that plate from `inline-flex` to the full-width row: see its module note.
 */
export function WeekSummary({
  summary,
  children,
}: {
  summary: Summary;
  /** The attention window, which sits at the plate's right end after the dial. */
  children?: ReactNode;
}) {
  // The dial's arc. Null (nothing projected) draws an empty track rather than a
  // zero-length arc at the top, which would read as 0%.
  const degrees = summary.winPct === null ? 0 : (summary.winPct / 100) * 360;
  const pct = formatProjectedWinPct(summary);

  return (
    // `ml-auto` above `sm` puts the week at the plate's far end, against the
    // name at its near one. Below `sm` it takes a line of its own — the plate
    // wraps rather than truncating a display name, which is the plate's
    // subject.
    <div className="flex w-full flex-wrap items-stretch gap-3 sm:ml-auto sm:w-auto sm:gap-4">
      {/* The groove that separates the name from the week. Drawn here rather
          than by the plate because it belongs to this block: on a wrapped line
          it would be a stub hanging off the left edge. */}
      <Groove className="hidden sm:block" />

      <Figure label="Proj rec">{formatProjectedRecord(summary)}</Figure>

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
          <div className="absolute inset-3 flex flex-col items-center justify-center overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--readout-shadow)]">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
            />
            <span className="relative font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-readout/60">
              Win
            </span>
            {/* 17px, stepping down at six characters. `100.0%` measures
                61.2px inside a 62px window whose widest chord is 60.8px at the
                figure's own height, so the one value a small account is most
                likely to project — every league a win — is the one that would
                clip. Every shorter reading keeps the design's own size. */}
            <span
              className={`relative mt-0.5 font-mono leading-none text-readout [text-shadow:var(--readout-text-glow)] ${
                pct.length > 5 ? "text-[0.9375rem]" : "text-[1.0625rem]"
              }`}
            >
              {pct}
            </span>
          </div>
        </div>
        {/* Dropped below `sm` on the manager plate's own measurement: the whole
            block has to fit a 332px plate there, and the lit window inside the
            dial already reads "WIN 50.0%". */}
        <span className="hidden max-w-16 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60 sm:inline">
          Proj win
        </span>
      </div>

      {children}
    </div>
  );
}

/**
 * One engraved figure under its etched label.
 *
 * A `<dl>` per field rather than one list holding both, for `SeasonSummary`'s
 * reason: the grooves between them are not list content, and a definition list
 * may hold only `dt`, `dd` and the `div`s grouping them.
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
