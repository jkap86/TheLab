import type { ManagerLeague } from "@/shared/contract";

import {
  formatCombinedRecord,
  formatWinPct,
  seasonSummary,
} from "../helpers/season-summary";

/**
 * The season, as one machined housing: an engraved two-row ledger beside a
 * gauge.
 *
 * The split is the point. Leagues and the combined record are *counts* — they
 * belong in a ledger, right-aligned on hairlines, where the eye compares them
 * to nothing. The win rate is a *proportion*, so it gets the instrument: a
 * dial whose arc is the number, with the figure repeated in a lit window at
 * the centre because an arc alone cannot be read to a decimal.
 *
 * Everything here is taken over the unfiltered league list — see
 * {@link seasonSummary} for why, and for why a league without a record is
 * skipped rather than counted as `0-0`.
 */
export function SeasonSummary({
  leagues,
}: {
  /** The unfiltered list, as it arrived on the stream. */
  leagues: readonly ManagerLeague[];
}) {
  const summary = seasonSummary(leagues);
  // The dial's arc. Null (no league has a record yet) draws an empty track
  // rather than a zero-length arc at the top, which would read as 0%.
  const degrees = summary.winPct === null ? 0 : (summary.winPct / 100) * 360;

  return (
    <div className="inline-flex items-center rounded-2xl border border-foreground/8 bg-[image:var(--key-bg)] p-2.5 shadow-[var(--plate-shadow)]">
      {/* The footnote sits beside the `<dl>` rather than inside it: a
          definition list may hold only `dt`, `dd` and the `div`s grouping
          them. */}
      <div className="py-1 pl-1.5 pr-5">
        <dl className="m-0">
          <Row label="Leagues" value={String(summary.leagues)} />
          <Rule />
          <Row label="Record" value={formatCombinedRecord(summary)} />
          <Rule />
        </dl>
        <p className="mt-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
          {summary.games > 0
            ? `${summary.games} games${summary.ties > 0 ? "" : " · no ties"}`
            : "No games on file"}
        </p>
      </div>

      <span
        aria-hidden
        className="mx-2 my-[0.1875rem] w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
      />

      <div className="flex flex-col items-center gap-2 px-1.5">
        <div className="relative size-28 rounded-full border border-foreground/10 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)]">
          {/* The arc itself. A conic gradient rather than an SVG ring: the
              angle is the only thing that varies, and it varies per render. */}
          <span
            aria-hidden
            className="absolute inset-[0.5625rem] rounded-full shadow-[inset_0_0_12px_rgba(0,0,0,0.95)]"
            style={{
              background: `conic-gradient(var(--accent) 0deg ${degrees}deg, var(--dial-track) ${degrees}deg 360deg)`,
            }}
          />
          {/* The pointer, parked at the end of the arc. Rotating a wrapper and
              pinning the dot to its top edge keeps the maths to one angle. */}
          {summary.winPct !== null && (
            <span
              aria-hidden
              className="absolute inset-[0.5625rem] rounded-full"
              style={{ transform: `rotate(${degrees}deg)` }}
            >
              <span className="absolute -top-1 left-1/2 -ml-1 size-[0.5625rem] rounded-full bg-readout shadow-[0_0_12px_var(--accent-glow)]" />
            </span>
          )}
          {/* The lit window at the centre, so the arc can be read exactly. */}
          <div className="absolute inset-[1.1875rem] flex flex-col items-center justify-center overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--readout-shadow)]">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
            />
            <span className="relative font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-readout/60">
              Win
            </span>
            <span className="relative mt-0.5 font-mono text-[1.375rem] leading-none text-readout [text-shadow:var(--readout-text-glow)]">
              {formatWinPct(summary)}
            </span>
          </div>
        </div>
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
          Win rate
        </span>
      </div>
    </div>
  );
}

/** One engraved ledger row: mono label left, tabular figure right. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-7 pb-2">
      <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
        {label}
      </dt>
      {/* `nowrap`: the en dash in `8–5` is a line-break opportunity, and a
          record split across two lines reads as two numbers. */}
      <dd className="m-0 whitespace-nowrap font-display text-[1.625rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/**
 * The hairline between rows: an accent-lit line with a dark one under it, which
 * is the same two-part trick the groove uses — one line alone reads as drawn,
 * two read as cut.
 */
function Rule() {
  return (
    <div
      aria-hidden
      className="h-px bg-gradient-to-r from-active/30 to-foreground/5 shadow-[0_1px_0_rgba(0,0,0,0.8)]"
    />
  );
}
