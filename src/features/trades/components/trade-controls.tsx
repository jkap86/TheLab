"use client";

import { CONSOLE_HOUSING, CONSOLE_KEY } from "@/features/shared";

import { TRADE_CIRCLES, circleIndex, stepCircle } from "../filters";
import type { TradeCircle } from "../filters";

/** The id the stepper's keys point at for their description. */
export const CIRCLE_NOTE_ID = "trade-circle-note";

/**
 * How far out the board is drawn — **a stepper along one axis, not four
 * checkboxes.**
 *
 * The circles nest (`mine ⊆ leaguemates ⊆ leaguemate-leagues ⊆ all`), so
 * offering them as independent options would be offering unions that are always
 * just the widest one ticked. What actually varies is a radius, and a radius has
 * two presses.
 *
 * **Both keys go inert without a stored account**, and that rule lives in
 * `stepCircle` rather than here: every circle but the widest is drawn around a
 * Sleeper account, so with none stored the whole ladder is one rung. A reader in
 * that state sees the pips at the widest notch and the keys unlit, which is the
 * page saying "look an account up on /tools" without a sentence.
 */
export function CircleStepper({
  circle,
  onChange,
  hasAccount,
}: {
  circle: TradeCircle;
  onChange: (circle: TradeCircle) => void;
  hasAccount: boolean;
}) {
  const index = circleIndex(circle);
  const option = TRADE_CIRCLES[index];
  const narrower = stepCircle(circle, -1, hasAccount);
  const wider = stepCircle(circle, 1, hasAccount);

  return (
    <div className={`${CONSOLE_HOUSING} gap-1.5`}>
      <button
        type="button"
        onClick={() => narrower && onChange(narrower)}
        disabled={narrower === null}
        aria-describedby={CIRCLE_NOTE_ID}
        aria-label="Narrower circle"
        className={`${CONSOLE_KEY} px-3 disabled:opacity-35 disabled:shadow-none`}
      >
        −
      </button>

      <span className="relative inline-flex min-w-0 items-center gap-2.5 overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] px-3.5 py-1.5 shadow-[var(--readout-shadow)]">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
        />
        <span className="relative truncate font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-readout">
          {option.label}
        </span>
        {/* The pips are the radius made visible: four notches, lit up to the
            one selected, so "wider" and "narrower" have somewhere to point.
            Decorative — the label beside them is the real answer. */}
        <span aria-hidden className="relative flex shrink-0 items-center gap-1">
          {TRADE_CIRCLES.map((c, i) => (
            <span
              key={c.value}
              className={`size-1 rounded-full ${
                i <= index ? "bg-readout" : "bg-readout/25"
              }`}
            />
          ))}
        </span>
      </span>

      <button
        type="button"
        onClick={() => wider && onChange(wider)}
        disabled={wider === null}
        aria-describedby={CIRCLE_NOTE_ID}
        aria-label="Wider circle"
        className={`${CONSOLE_KEY} px-3 disabled:opacity-35 disabled:shadow-none`}
      >
        +
      </button>
    </div>
  );
}

/**
 * What the selected circle means, in a sentence.
 *
 * Read on **every** circle rather than only the narrow ones: the two leaguemate
 * readings are not separable by name — one is about who was dealing and the
 * other about where the deal happened — so the label names the circle and this
 * says what that name means.
 */
export function CircleNote({
  circle,
  hasAccount,
}: {
  circle: TradeCircle;
  hasAccount: boolean;
}) {
  const option = TRADE_CIRCLES[circleIndex(circle)];
  return (
    <p
      id={CIRCLE_NOTE_ID}
      className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60"
    >
      {option.note}
      {/* Said once, where the inert keys are: without an account there is no
          centre to draw a circle around. */}
      {!hasAccount && " Look up an account on Tools to narrow it."}
    </p>
  );
}
