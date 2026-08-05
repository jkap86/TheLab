import type { ReactNode } from "react";

/**
 * A raised key, in the app bar's own material grammar (`.lab-chip`) rather than
 * the flat bordered `Segment` this replaced.
 *
 * The whole drawer is keys instead of segments — the season, the window
 * presets, the filter tray's trigger — and that is the point: a part you press
 * should look pressable everywhere, and the drawer was the one place in the app
 * still drawing its own outlined buttons. `.lab-chip-on` is the lit state, the
 * same one the filter triggers wear when they are narrowing something.
 *
 * `small` is `.lab-chip-sm`, the half-thickness spelling — worn by the window
 * presets, which sit on the strip's caption where full-thickness keys would
 * outweigh the dates they are next to.
 */
export function KeyChip({
  on,
  small = false,
  onClick,
  children,
}: {
  on: boolean;
  small?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`lab-chip rounded-full font-semibold transition-colors ${
        small ? "lab-chip-sm px-2 py-[1px] text-[0.62rem]" : "px-2.5 py-[3px] text-[0.7rem]"
      } ${on ? "lab-chip-on" : "text-foreground/70"}`}
    >
      {children}
    </button>
  );
}
