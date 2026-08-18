/**
 * The app's type scale, read off the document rather than re-declared here.
 *
 * `--app-font-scale` lives in `globals.css` and is the one lever over every size
 * in the app (see the note on it there). Almost nothing needs to *know* the
 * number: type, spacing and every track cut to hold them are in `rem`, so they
 * scale by arithmetic the browser does. What needs it is the one place a length
 * has to exist as a **number in JavaScript** — a windowed list that positions its
 * rows absolutely, where the row's height and the offsets it is placed at must be
 * the same value or the list drifts a pixel a row.
 *
 * **It reads the computed root font size rather than the variable**, which is the
 * difference between a mirror and a source. Parsing `--app-font-scale` would
 * duplicate the multiplication and, worse, would be wrong for a reader who has
 * raised their browser's default font size — the whole reason that rule is
 * written as a percentage. `font-size` on `<html>` is the product of the two, and
 * the product is what a `rem` actually resolves against.
 *
 * **The base is 16 because that is the number the constants were taken at**, not
 * because the browser's default is assumed to be 16. A track measured as 33px
 * against `text-sm` was measured against a 16px root, so what this returns is the
 * factor those measurements have to be multiplied by, whatever moved the root.
 *
 * On the server there is no document and this answers 1. That is exact rather
 * than a fallback for the only caller: the ADP drawer is latch-mounted behind a
 * press, so it has never rendered on the server and no row's height crosses the
 * hydration boundary. A future caller that *does* render on both sides must not
 * put this in markup without saying so — a scale of 1.125 would make the server's
 * attribute disagree with the client's.
 */
const BASE_PX = 16;

let cached: number | null = null;

export function rootFontScale(): number {
  if (typeof document === "undefined") return 1;
  if (cached !== null) return cached;
  const px = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  // A `getComputedStyle` per row per frame is exactly the forced reflow the
  // trades list observes its header to avoid, and the scale cannot change
  // without a stylesheet swap, so one read per process is honest.
  cached = Number.isFinite(px) && px > 0 ? px / BASE_PX : 1;
  return cached;
}

/**
 * A length taken at a 16px root, in px at the scale actually in force.
 *
 * Rounded, because the callers are pixel offsets: a fractional row height
 * accumulates into a visible seam a few hundred rows down, where a rounded one
 * is exact against a row that is *given* the same rounded number.
 */
export function scaledPx(atBase16: number): number {
  return Math.round(atBase16 * rootFontScale());
}
