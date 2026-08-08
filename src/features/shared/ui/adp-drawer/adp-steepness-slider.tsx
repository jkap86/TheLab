import { STEEPNESS_RANGE, steepnessSummary } from "../../adp-controls";

/**
 * The value curve, as one continuous control.
 *
 * It was three segments — Flat, Balanced, Top-heavy — which is three points on a
 * scale that is continuous underneath: the knob is how many times value halves
 * across a league's startable pool, and there was never anything special about
 * 3, 4 and 5. A slider says that, and the board below re-prices as it moves, so
 * the curve is chosen by watching what it does rather than by reading three
 * adjectives. The ends keep the adjectives as the axis labels, which is the job
 * they were always doing.
 *
 * **Dragging previews; releasing commits.** Every committed value re-fetches the
 * team value of every league on the tab behind this drawer, so a drag across the
 * range would fire two dozen of those. `onPreview` runs per notch (the board
 * below is local and free), `onCommit` runs on release — pointer, key or focus
 * leaving, since a slider is as often nudged with the arrow keys as dragged.
 */
export function SteepnessSlider({
  value,
  onPreview,
  onCommit,
}: {
  value: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  // The release events carry no value of their own, so it is read back off the
  // input — which is controlled, so what it holds is what was last previewed.
  const commit = (e: { currentTarget: HTMLInputElement }) =>
    onCommit(Number(e.currentTarget.value));

  return (
    <div className="flex items-center gap-2">
      {/* No `Curve` caption: this sits inside the bay the Curve key opened, and
          that key names the field eight pixels above it — a label beside a
          control must not restate what the control already says. The axis ends
          and the readout stay, because neither is on the key. */}
      <span aria-hidden className="text-[0.6rem] text-foreground/25">
        Flat
      </span>
      <input
        type="range"
        className="lab-slider min-w-0 flex-1"
        min={STEEPNESS_RANGE.min}
        max={STEEPNESS_RANGE.max}
        step={STEEPNESS_RANGE.step}
        value={value}
        aria-label="Value curve steepness"
        aria-valuetext={steepnessSummary(value)}
        onChange={(e) => onPreview(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span aria-hidden className="text-[0.6rem] text-foreground/25">
        Top-heavy
      </span>
      {/* The halving count is the honest parameter and an unreadable label, so
          the readout says what it does to a board instead.

          It is not the same number as the Curve key above, though it reads as
          one at rest: this is the value **being previewed**, and the key holds
          the committed one until the handle is let go. Mid-drag the two differ
          on purpose — the live figure belongs under the finger, and the key is
          where the reader came from. */}
      <span className="shrink-0 text-[0.62rem] tabular-nums text-foreground/40">
        {steepnessSummary(value)}
      </span>
    </div>
  );
}
