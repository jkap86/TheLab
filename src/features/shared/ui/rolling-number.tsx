"use client";

/** The ten faces of one odometer column, in the order `translateY` reads. */
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * A number whose digits roll in place — the drawer's draft count as an
 * instrument needle rather than a swap.
 *
 * The layout copy is the real text at opacity zero, so the box, the baseline
 * and what a screen reader gets are exactly the plain string; the rolling
 * columns are an `aria-hidden` overlay on top of it. Tabular numerals make
 * every digit exactly one `ch` wide, which is what lets the overlay's columns
 * sit over the copy without measuring anything — the caller's cell already
 * sets `tabular-nums` for the usual lining-up reason, and this depends on it.
 *
 * A digit that changes rolls to its new face; a separator never moves; a value
 * that changes *length* re-keys every column and simply appears, because a
 * roll between re-numbered positions would animate a lie. `leading-none` pins
 * the line box to one em so the neighbouring faces stay outside the clip, and
 * the roll is a plain transform transition — `motion-reduce` stills it and the
 * number just changes.
 */
export function RollingNumber({ value }: { value: string }) {
  return (
    <span className="relative inline-block leading-none tabular-nums">
      <span className="opacity-0">{value}</span>
      <span aria-hidden className="absolute inset-0 flex overflow-hidden">
        {Array.from(value).map((ch, i) =>
          /\d/.test(ch) ? (
            <span
              key={`${value.length}-${i}`}
              className="inline-block h-full w-[1ch] overflow-hidden"
            >
              <span
                className="flex flex-col transition-transform duration-500 motion-reduce:transition-none"
                style={{ transform: `translateY(-${Number(ch)}em)` }}
              >
                {DIGITS.map((digit) => (
                  <span key={digit} className="h-[1em] text-center leading-none">
                    {digit}
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span key={`${value.length}-${i}`}>{ch}</span>
          ),
        )}
      </span>
    </span>
  );
}
