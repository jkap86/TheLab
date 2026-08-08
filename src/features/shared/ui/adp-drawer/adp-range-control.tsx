"use client";

import type { DraftDensityMonth } from "@/shared/manager";

import { type AdpRange, rangeBounds } from "../../adp-controls";
import type { AdpDensityState } from "../../use-adp-density";
import { LookbackPanel } from "../lookback-panel";

/**
 * The window control: the lookback counter itself, inside the Window bay.
 *
 * **It has been behind a press, then on the page, and is behind one again — and
 * the terms changed each time, which is the only reason the third arrangement is
 * not the first one back.** What it was originally was a *trigger* carrying the
 * board's name and a 16px sparkline, with a row of relative presets beside it
 * (`All 2026`, `30 days`, `90 days`) and the counter floating on a press. That
 * failed for a reason that had nothing to do with the collapse: the presets made
 * the population look **answered**, so a reader who found "30 days" sufficient
 * never learned there was an instrument behind the chevron. Seating it
 * permanently fixed that and cost ~190px of a pinned block, which the board paid
 * for out of its own height.
 *
 * The bay is the third answer and keeps both halves. The counter is behind a
 * press again, so the block is one rail line; and the key in front of it carries
 * the board's own label **and** the density — the two facts the presets were
 * hiding — so nothing about the window reads as answered. What does not come
 * back is a row of fixed windows: there is still exactly one way to each of them
 * (a day count in the lens, the lens left empty, the ◆ key), which is the rule
 * below and the thing any future edit here has to keep.
 *
 * Two consequences worth knowing:
 *
 *   - **It draws no face.** It had one while it was seated in the block, where
 *     it needed a surface to stand on; the bay is that surface now, and two
 *     near-identical gradients read as one surface with a seam — see the body.
 *   - **The presets are the counter's fields.** "Last 30 days" is a day count
 *     typed or stepped into the lens, "All of 2026" is that lens left empty, and
 *     "since the NFL draft" is the ◆ key the panel has always carried — the one
 *     anchor no fixed chip could hold, since the date moves every April.
 *     Removing a way *into* one of those three is removing the only one.
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
    // **No face of its own — the bay is the face.** It carried one while it was
    // seated in the pinned block, where it needed a surface to stand on; inside
    // the Window bay that surface is the bay's, and the two gradients were near
    // enough identical (`148deg,#1a3140→#0c1c28` against the bay's
    // `#1b3040→#0d1c27`) that the result read as one surface with a seam cut
    // across it rather than as a part seated in another. That is the failure
    // `.lab-plate-sm` exists to name, and the fix here is to draw one surface
    // rather than to brighten a second.
    //
    // The `px-1` is all that survives of it, and it is load-bearing: the
    // counter's accent rail hangs at `-left-3`, so with no inset at all the rail
    // is clipped against the bay's own padding.
    <div className="px-1">
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
