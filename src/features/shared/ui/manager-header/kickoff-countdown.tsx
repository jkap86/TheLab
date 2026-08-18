import { countdownSegments, formatCountdown } from "../../format";

/**
 * A live countdown to the season's opening kickoff, drawn as a segment readout:
 * one milled cell per unit, the running unit lit, units labelled under their
 * digits.
 *
 * The cells are one row, never two. Wrapped into a 2×2 block they read as four
 * separate numbers rather than as one clock — the units run largest to smallest,
 * which is a left-to-right sentence, and breaking it after the hours puts the
 * minutes under the days. So the row sizes to its own contents (`w-fit`) and the
 * name beside it truncates instead, the same trade the plate already makes for
 * its corner tabs. It keeps the dial's *height* rather than its square, since the
 * two share the slot and the plate must not change height when the season turns
 * over.
 *
 * **The digits grew into that height rather than past it.** The readout was
 * ~40px of type inside a 68px box — the plate's one moving number set smaller
 * than the manager's name beside it — so the cells take the slack the box
 * already had: the whole group is still exactly the dial's height, and the plate
 * pinned over a several-hundred-row list covers the same amount of it as before.
 * Growing the *box* is the one move not available here, which is why the sizing
 * is written as type and padding inside a fixed height and not as a height of
 * its own. The box has since come *down* to 56/66px — it is what sets the
 * plate's height, so it is the first lever when the pinned card is taking too
 * much of the list — and the type stayed, which is the same argument run the
 * other way: what is left is the slack, not the digits.
 *
 * What the extra size buys is the material: at 12px a cell could only be a tinted
 * box, where at 26px it can be a machined lens (`.lab-readout`) with the running
 * unit's own housing lit rather than just its digit. The header rail is a
 * hairline and a tick rather than a bare caption, for the same reason — the
 * label of an instrument is part of the instrument.
 *
 * A cell's digits are padded ({@link countdownSegments}), so the readout ticks in
 * place; a cell is also floored at the width of two digits, so the days cell
 * doesn't narrow the row the day it drops from three digits to two. The row
 * narrows only when a unit empties for good.
 *
 * The cells are decoration to a screen reader — the digits are split across four
 * elements and would be read as four numbers — so the group carries
 * {@link formatCountdown}'s string as its label and the cells are hidden. The
 * two are one calculation, so they cannot drift.
 */
export function KickoffCountdown({ msLeft }: { msLeft: number }) {
  const segments = countdownSegments(msLeft);

  return (
    <div
      // **`role="timer"`, because `aria-label` on a bare `<div>` is ignored.**
      // Every cell below is `aria-hidden` (four elements would be read as four
      // unrelated numbers), so without a role to hang the label on the whole
      // countdown was invisible to a screen reader rather than merely awkward.
      // `timer` is a `status` whose implicit `aria-live` is `off`, which is
      // exactly right for a value that changes every second: named and readable
      // on demand, never announced on its own.
      role="timer"
      className="grid h-[3.5rem] w-fit flex-none content-center gap-1 sm:h-[4.125rem] sm:gap-1.5"
      aria-label={`Kickoff in ${formatCountdown(msLeft)}`}
    >
      {/* The label as a rail: a lit tick, the words, then a hairline running out
          to the right edge of the cells under it. A caption centred over the row
          floated; ruled across it, it reads as the instrument's own header. */}
      <span
        aria-hidden="true"
        className="flex items-center gap-1.5 text-[0.5rem] font-bold uppercase leading-none tracking-[0.16em] text-active/70 sm:text-[0.5625rem]"
      >
        <span className="h-2 w-[2px] flex-none rounded-full bg-active shadow-[0_0_8px_rgba(0,255,229,0.7)]" />
        Kickoff in
        <span className="h-px flex-1 bg-gradient-to-r from-active/25 to-transparent" />
      </span>

      {/* The cells are tighter and a size down below `sm` for the one reason the
          plate keeps running into: the row shares a line with the manager's
          name, and this control growing is the name's width being spent. A
          phone gets the material and most of the size; a laptop gets all of
          it. */}
      <span aria-hidden="true" className="flex gap-[3px] sm:gap-1">
        {segments.map((segment, index) => (
          <CountdownCell
            key={segment.unit}
            value={segment.value}
            unit={segment.unit}
            // The last cell is the one that is always moving, so it is the one
            // that is lit — housing included. Four lit cells read as a sign; one
            // reads as a clock that is running.
            live={index === segments.length - 1}
          />
        ))}
      </span>
    </div>
  );
}

/** One unit's lens: the digits, the unit under them, lit where it is running. */
function CountdownCell({
  value,
  unit,
  live,
}: {
  value: string;
  unit: string;
  live: boolean;
}) {
  return (
    <span
      className={`flex-none rounded-[5px] px-1 pb-[3px] pt-[3px] text-center sm:px-1.5 ${
        live ? "lab-readout lab-readout-live" : "lab-readout"
      }`}
    >
      <span
        className={`block min-w-[1.35em] font-mono text-[1.1875rem] font-bold leading-[1.02] tabular-nums tracking-tight sm:text-[1.625rem] ${
          live
            ? "text-active drop-shadow-[0_0_14px_rgba(0,255,229,0.55)]"
            : "text-foreground/90 drop-shadow-[0_1px_0_rgba(0,0,0,0.6)]"
        }`}
      >
        {value}
      </span>
      <span
        className={`mt-[1px] block text-[0.4375rem] font-bold uppercase leading-none tracking-[0.12em] ${
          live ? "text-active/55" : "text-foreground/30"
        }`}
      >
        {unit}
      </span>
    </span>
  );
}
