"use client";

import type { RefObject } from "react";

import type { DraftDensityMonth } from "@/shared/manager";

import type { AdpControls } from "../../adp-controls";
import {
  type AdpBayId,
  type AdpBayState,
  adpBayStates,
  densitySpark,
} from "./adp-drawer.utils.ts";

/**
 * The pinned block's whole control surface: three keys in a milled rail, each
 * naming what its bay is set to, one of them opening at a time.
 *
 * It replaced four parts stacked — the window instrument, the filter row and the
 * curve slider under the identity line — which took 314px of a 660px panel and
 * left nine rows of board. The rail is one line, and the bay it opens floats over
 * the board rather than pushing it: **the block is a constant ~94px in every
 * state and the board is seventeen rows**, so nothing reflows and no press costs
 * a row.
 *
 * **The measurement that made the float affordable is worth keeping written
 * down**, because "a panel over the board" reads as obviously wrong and isn't:
 * the window bay is ~197px, so it hides five rows and leaves twelve — where the
 * stacked block showed nine with nothing open at all.
 *
 * **The Leagues bay is the exception, and the exception is earned rather than
 * overlooked.** It is the whole league-filters panel, capped at `min(66svh,
 * 32rem)`, so it covers most of the board. What makes that fine is that it is
 * the one bay whose selection is a *draft*: nothing under it moves until Apply,
 * so there is no board to be watching while it is up — and Apply shuts it, which
 * is the press that makes the board worth looking at again. The curve and the
 * window commit live and are short, which is the same fact from the other side.
 *
 * Two signals, and they must not be merged:
 *
 *   - **Sunk means open.** The pressed key drops into the rail and its bay stands
 *     above it — the app bar's grammar exactly, where raised means press me and
 *     recessed means you are here. It is what says which key a floating panel
 *     came from, and it is why the open key is not simply lit.
 *   - **Cyan means narrowed**, never open. It is the same question the app-bar
 *     trigger's bars answer, so a key goes accent when this bay is moving the
 *     board away from the one everybody else sees. Spending the token on "open"
 *     would leave nothing to say that with.
 *
 * The values themselves are {@link adpBayStates}, which is pure and tested: a key
 * that names a board the panel behind it disagrees with is the failure that rule
 * exists to stop.
 */
export function AdpBayRail({
  controls,
  months,
  open,
  bayId,
  openKeyRef,
  onToggle,
}: {
  controls: AdpControls;
  /** The density rows for this season — the Window key's own picture. */
  months: readonly DraftDensityMonth[];
  /** Which bay is up, or null. */
  open: AdpBayId | null;
  /** The floating bay's element id, for `aria-controls` on the key that owns it. */
  bayId: string;
  /**
   * Handed to whichever key is currently open, so Escape can put focus back on
   * it — a bay closing under a keyboard reader unmounts the control they were
   * in, and the browser drops them on `<body>`.
   */
  openKeyRef: RefObject<HTMLButtonElement | null>;
  onToggle: (bay: AdpBayId) => void;
}) {
  const states = adpBayStates(controls);
  // Only the window key draws one, and only where the season has drafts to
  // draw: an empty slot beside a label is worse than a label alone.
  const spark = densitySpark(months);

  return (
    <div className="lab-trough flex items-stretch gap-1.5 rounded-[10px] p-1">
      {states.map((state) => (
        <BayKey
          key={state.id}
          state={state}
          open={open === state.id}
          bayId={bayId}
          buttonRef={open === state.id ? openKeyRef : undefined}
          spark={state.id === "window" ? spark : null}
          onClick={() => onToggle(state.id)}
        />
      ))}
    </div>
  );
}

/**
 * One key: the field over the answer, with the caret that says a bay is behind
 * it.
 *
 * Equal `flex-1` shares rather than content widths, because the tongue on the
 * bay below is placed at a fraction of the rail (see {@link AdpBay}) — keys that
 * sized to their own text would move under a tongue that doesn't know they did.
 * `min-w-0` is what lets the value truncate instead of forcing the rail wider
 * than the panel.
 */
function BayKey({
  state,
  open,
  bayId,
  buttonRef,
  spark,
  onClick,
}: {
  state: AdpBayState;
  open: boolean;
  bayId: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  /** Bar heights in `0..1`, or null on a key that carries no picture. */
  spark: number[] | null;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      // Only the open key controls anything: `aria-controls` pointing at an id
      // that is not in the document is a reference resolving to nothing, which
      // is exactly what the drawer's own markup test forbids.
      aria-controls={open ? bayId : undefined}
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-start gap-px rounded-[7px] px-2 py-1 text-left transition-colors ${
        open ? "lab-well" : "lab-chip lab-chip-sm"
      }`}
    >
      <span
        className={`flex w-full items-center gap-1.5 text-[0.53rem] font-bold uppercase tracking-[0.17em] ${
          open ? "text-active/60" : "text-foreground/40"
        }`}
      >
        {state.label}
        {spark !== null && spark.length > 0 && <Spark bars={spark} />}
        <Caret open={open} />
      </span>
      <span
        className={`w-full truncate text-[0.72rem] font-bold ${
          state.narrowed ? "text-active" : "text-foreground/80"
        }`}
      >
        {state.value}
      </span>
    </button>
  );
}

/**
 * The window key's density, as bars standing in the caption line.
 *
 * `aria-hidden`, because it is the same fact as the label beside it drawn as a
 * picture — a screen reader that heard eight unlabelled bars would be worse off
 * than one that heard "Window, All of 2026". They wear `.lab-channel-bar-lit`
 * without the channel around them: at 9px a cut would be a smudge, and what the
 * mark is for here is *where the drafts are*, which the heights carry alone.
 */
function Spark({ bars }: { bars: number[] }) {
  return (
    <span aria-hidden className="flex h-[9px] shrink-0 items-end gap-px">
      {bars.map((height, i) => (
        <span
          // The bars are a shape, not a list of things — position is the whole
          // of their identity, so the index is the honest key.
          key={i}
          className="w-[2px] rounded-t-[1px] lab-channel-bar-lit"
          style={{ height: `${Math.round(height * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** The disclosure mark, rotating rather than swapping, so the mark being read is the one that moves. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`ml-auto h-2.5 w-2.5 shrink-0 transition-transform duration-150 ${
        open ? "-rotate-180 text-active/70" : "text-foreground/35"
      }`}
    >
      <path
        d="M3 4.5 6 8l3-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
