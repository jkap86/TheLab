"use client";

import type { DraftDensityMonth } from "@/shared/manager";

import { type AdpRange, rangeBounds } from "../../adp-controls";
import type { AdpDensityState } from "../../use-adp-density";
import { LookbackPanel } from "../lookback-panel";

/**
 * The window control: the lookback counter itself, seated in the pinned block.
 *
 * It used to be one line behind a press — a trigger carrying the board's name
 * and a sparkline of the density, with the counter floating over the panel when
 * it was opened, and a row of relative presets (`All 2026`, `30 days`,
 * `90 days`) beside it. Both are gone, and the two removals are one decision:
 * the window is the board's population, so setting it is the first thing the
 * drawer is opened for, and a control that has to be found is a control most
 * readers never learn is there. What the collapse was buying — height in a
 * block that is pinned above a scrolling board — is real and is what it costs;
 * what it was spending is the instrument.
 *
 * Three consequences worth knowing, because each undoes a note that stood here:
 *
 *   - **The resting line went with the press, not merely the float.** Its two
 *     halves were a picture of the density (the panel's own channel, at 16px)
 *     and the board's name (the panel's own caption). Kept beside an open panel
 *     they would be the same two facts twice, and the drift risk is one edit
 *     away — which is exactly the reason the sparkline was drawn by calling the
 *     channel's own functions rather than being handed measurements.
 *   - **It is seated, not raised.** The floating panel earned its lit face and
 *     its cast shadow by being *over* the rows below it; nothing floats now, so
 *     the face keeps its grade (the channel is a cut into it, and a cut needs a
 *     face to be cut into) and trades the drop shadow for a wall. Raised over
 *     the block, not hovering above it.
 *   - **The presets are the counter's fields now.** "Last 30 days" is a day
 *     count typed or stepped into the lens, "All of 2026" is that lens left
 *     empty, and "since the NFL draft" is the ◆ key the panel has always
 *     carried — the one anchor no fixed chip could hold, since the date moves
 *     every April. What no longer exists is a second control saying the same
 *     things one press earlier.
 */
export function AdpRangeControl({
  range,
  season,
  defaultSeason,
  months,
  density,
  today,
  onChange,
}: {
  range: AdpRange;
  season: string;
  defaultSeason: string;
  /** The density rows for this season — what the channel is drawn from. */
  months: DraftDensityMonth[];
  density: AdpDensityState;
  /** `YYYY-MM-DD`, resolving a window that ends today. */
  today: string;
  onChange: (range: AdpRange) => void;
}) {
  const bounds = rangeBounds(range, today);
  // Only a board that can contain today gets an axis running to it.
  const live = season === "all" || season === defaultSeason;

  return (
    // The face the floating panel wore, seated: the same grade from a lit near
    // corner (the channel inside it is a cut, and a cut is read against the face
    // it is cut into), with the cast shadow traded for a wall — a part standing
    // on the pinned block rather than one hovering over it. The `px-3` is what
    // the counter's accent rail hangs in, so trimming it takes the rail off the
    // field's edge.
    <div className="rounded-lg border border-active/15 bg-[linear-gradient(148deg,#1a3140,#12242f_46%,#0c1c28)] px-3 pb-2.5 pt-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-6px_11px_rgba(0,0,0,0.4),0_2px_0_var(--edge)]">
      <LookbackPanel
        range={range}
        season={season}
        bounds={bounds}
        months={months}
        live={live}
        error={density.error}
        loading={density.loading}
        today={today}
        onChange={onChange}
      />
    </div>
  );
}
