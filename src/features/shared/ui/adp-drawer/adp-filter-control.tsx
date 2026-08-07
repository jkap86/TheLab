import { compactSelect } from "../../control-type.ts";

/**
 * A filter as a chip. It is a real `<select>` under the styling rather than a
 * bespoke menu, so keyboard and touch behaviour come free and the pinned block
 * costs one line per filter instead of a labelled row.
 *
 * `narrowed` tints a chip that is actually cutting the population, which is what
 * lets the row be read at a glance: the accented chips are the board.
 *
 * **A real `<select>` is also a control iOS zooms the page for**, which is what
 * {@link compactSelect} answers: 16px type with the horizontal padding given
 * back, since this is the one control here whose row *wraps* — where wider text
 * is paid in rows rather than in width. Measured, the tray holds the two rows it
 * held before, at 390px and at 360px both.
 */
export function ChipSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  narrowed = false,
  className = "",
}: {
  value: T | "";
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Shown as a disabled first option — for a chip that acts rather than selects. */
  placeholder?: string;
  narrowed?: boolean;
  /** Layout from the caller — this component owns the chip, not where it sits. */
  className?: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as T)}
      // The focus ring is *replaced*, never merely removed: `focus:outline-none`
      // on its own left the chip with no visible focus state at all, which is
      // the whole of WCAG 2.4.7 on a control a keyboard reader has to find among
      // seven identical pills.
      className={`max-w-[12rem] truncate rounded-full border ${compactSelect} transition-colors [color-scheme:dark] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active ${className} ${
        narrowed
          ? "border-active/32 bg-active/10 text-active hover:border-active/50"
          : "border-foreground/10 bg-foreground/5 text-foreground/60 hover:border-foreground/25 hover:text-foreground/85"
      }`}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
