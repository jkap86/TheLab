"use client";

import { CONSOLE_HOUSING, CONSOLE_KEY } from "@/features/shared";
import { LAST_REGULAR_WEEK } from "@/shared/projections/weeks";

/**
 * The week control: two keys in one machined housing with the week lit between
 * them.
 *
 * `week` comes off the payload rather than out of this component's state, which
 * is what makes the opening render honest — the page does not know which week
 * is current until the route says so, and a stepper that guessed would show one
 * week's heading over another week's numbers for a round trip. Until then the
 * readout says so and the keys are disabled: there is nothing to step from.
 *
 * `LAST_REGULAR_WEEK` is deep-imported from `projections/weeks` rather than
 * through that barrel, which reaches the network via `week-read` and is
 * server-only. The module is pure and zero-import for exactly this.
 */
export function WeekStepper({
  week,
  onChange,
}: {
  /** The week the payload answered for, or null before it has answered. */
  week: number | null;
  onChange: (week: number) => void;
}) {
  const step = (by: number) => {
    if (week === null) return;
    const next = week + by;
    if (next >= 1 && next <= LAST_REGULAR_WEEK) onChange(next);
  };

  return (
    <div className={`${CONSOLE_HOUSING} gap-1.5`}>
      <button
        type="button"
        className={CONSOLE_KEY}
        onClick={() => step(-1)}
        disabled={week === null || week <= 1}
        aria-label="Previous week"
      >
        <span aria-hidden>‹</span>
      </button>

      <span className="relative overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] px-4 py-2 shadow-[var(--readout-shadow)]">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
        />
        <span
          className="relative whitespace-nowrap font-mono text-[0.8125rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]"
          aria-live="polite"
        >
          {week === null ? "Week —" : `Week ${week}`}
        </span>
      </span>

      <button
        type="button"
        className={CONSOLE_KEY}
        onClick={() => step(1)}
        disabled={week === null || week >= LAST_REGULAR_WEEK}
        aria-label="Next week"
      >
        <span aria-hidden>›</span>
      </button>
    </div>
  );
}
