/**
 * A filter as a chip. It is a real `<select>` under the styling rather than a
 * bespoke menu, so keyboard and touch behaviour come free and the pinned block
 * costs one line per filter instead of a labelled row.
 *
 * `narrowed` tints a chip that is actually cutting the population, which is what
 * lets the row be read at a glance: the accented chips are the board.
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
      className={`max-w-[12rem] truncate rounded-full border px-2.5 py-1 text-xs transition-colors [color-scheme:dark] focus:outline-none ${className} ${
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
