import type { ReactNode } from "react";

import { BubblingFlask } from "./bubbling-flask";
import { MilledHairline, Scanlines } from "./card-plate";
import { StampedCount } from "./stamped-count";

/**
 * A week's figures, milled into the identity billet: two stamped counts in one
 * well — a record and one more figure the page chooses — and a mounted gauge
 * for the win rate the record implies.
 *
 * The lineup checker's `WeekSummary` with the words and the second count taken
 * as props, since the gametime page draws the identical gauge over a live
 * record: `Proj rec` / `Need a look` there, `Live rec` / `In play` here, one
 * part. `features/manager`'s `SeasonSummary` is the same object with a season's
 * figures, and the arguments for every measurement below are that file's and
 * the checker's — the `<dl>` for the gauge, the chord the figure is sized
 * against, the `lg:contents` that dissolves the block into the billet's row.
 *
 * **The six-character step-down stays.** `100.0%` — what a small account
 * projects when every league is a win — is the reading that clips, and a
 * window is a circle: a line of digits crossing it sits on a chord of
 * `2·√(r² − offset²)`, not on the diameter. Measured, the 108px window's chord
 * at the figure's own height is ~74px and `100.0%` at `--fs-21` is ~83; at
 * `--fs-17` it is ~68. Every five-character reading keeps the design's own
 * size.
 */
export function WeekGauge({
  record,
  winPct,
  pct,
  recordLabel,
  winLabel,
  count,
  pending,
  pendingLabel = "Reading",
}: {
  /** The record as printed — `8–5`, or an em dash. */
  record: string;
  /** Wins as a share of games, or null with nothing to divide — drives the arc. */
  winPct: number | null;
  /** The rate as printed — `61.5%`, or an em dash. */
  pct: string;
  recordLabel: string;
  winLabel: string;
  /** The second stamped count in the well. */
  count: {
    label: string;
    value: ReactNode;
    /** A colour, not a state — `StampedCount`'s own `tone`. */
    tone?: string;
    title?: string;
    live?: boolean;
    /** The figure is a drawn object rather than type — see `StampedCount`. */
    centred?: boolean;
  };
  /** True until the page's read lands: the dial draws a flask in its window. */
  pending: boolean;
  /** The flask's accessible name. */
  pendingLabel?: string;
}) {
  const degrees = winPct === null ? 0 : (winPct / 100) * 360;

  return (
    <div className="relative order-4 flex w-full items-stretch gap-2 border-t border-[color:var(--milled-hairline)] pt-2 shadow-[0_-1px_0_rgba(255,255,255,0.06)] lg:order-none lg:contents">
      <div className="relative order-2 flex min-w-0 flex-1 flex-col justify-center gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-3 py-2 shadow-[var(--standing-well-shadow)] lg:order-none lg:flex-none lg:gap-1 lg:px-3.5 lg:py-[0.4375rem]">
        <StampedCount label={recordLabel}>{record}</StampedCount>
        <span
          aria-hidden
          className="h-px bg-[color:var(--milled-hairline)] shadow-[0_1px_0_rgba(255,255,255,0.07)]"
        />
        <StampedCount
          label={count.label}
          tone={count.tone}
          live={count.live}
          centred={count.centred}
          title={count.title}
        >
          {count.value}
        </StampedCount>
      </div>

      <MilledHairline className="relative hidden lg:block" />

      <dl className="relative order-1 m-0 flex shrink-0 flex-col-reverse items-center gap-1 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-[0.4375rem] py-1.5 shadow-[var(--standing-well-shadow)] lg:order-none lg:flex-row lg:gap-3.5 lg:rounded-none lg:bg-none lg:p-0 lg:shadow-none">
        <dt className="whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:text-[length:var(--fs-10)] sm:tracking-[0.14em]">
          {winLabel}
        </dt>
        <dd className="relative m-0 size-21 shrink-0 rounded-full border border-foreground/12 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow),0_10px_18px_-10px_var(--surface-shadow)] lg:size-27 lg:shadow-[var(--bezel-shadow),0_12px_22px_-12px_var(--surface-shadow)]">
          <span
            aria-hidden
            className="absolute inset-1.5 rounded-full shadow-[inset_0_0_14px_rgba(0,0,0,0.95)] lg:inset-2"
            style={{
              background: `conic-gradient(var(--accent) 0deg ${degrees}deg, var(--dial-track) ${degrees}deg 360deg)`,
            }}
          />
          {winPct !== null && (
            <span
              aria-hidden
              className="absolute inset-1.5 rounded-full lg:inset-2"
              style={{ transform: `rotate(${degrees}deg)` }}
            >
              <span className="absolute -top-1 left-1/2 -ml-1 size-2 rounded-full bg-readout shadow-[0_0_12px_var(--accent-glow)] lg:-top-[0.28125rem] lg:-ml-[0.28125rem] lg:size-2.5 lg:shadow-[0_0_14px_var(--accent-glow)]" />
            </span>
          )}
          <div className="absolute inset-[0.6875rem] flex items-center justify-center overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--readout-shadow)] lg:inset-3.5">
            <Scanlines />
            {pending ? (
              <BubblingFlask size={34} phase={1} label={pendingLabel} />
            ) : (
              <span
                className={`relative font-display font-semibold leading-none tracking-[-0.02em] tabular-nums text-readout [text-shadow:var(--figure-engrave),0_0_20px_var(--accent-glow)] lg:[text-shadow:var(--figure-engrave),0_0_22px_var(--accent-glow)] ${
                  pct.length > 5
                    ? "text-[length:var(--fs-13)] lg:text-[length:var(--fs-17)]"
                    : "text-[length:var(--fs-17)] lg:text-[length:var(--fs-21)]"
                }`}
              >
                {pct}
              </span>
            )}
          </div>
        </dd>
      </dl>
    </div>
  );
}
