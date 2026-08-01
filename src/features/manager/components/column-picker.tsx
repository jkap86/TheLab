"use client";

/**
 * A column heading that doubles as a picker: the current metric's label with a
 * caret, opening a menu that swaps the whole column to another metric.
 *
 * The panel's two tables — standings and roster — both point their value columns
 * at a metric of the reader's choosing (team-level for the manager, player-level
 * for the roster), and this is the shared trigger-and-menu both use. It holds no
 * state of its own: which metric a column shows and whether its menu is open are
 * lifted to the panel, so one open-at-a-time and an outside-click-to-close have a
 * single owner (as they do on the collapsed card's {@link MetricColumn}).
 *
 * The trigger inherits its font size from the heading cell it sits in and only
 * sets the uppercase treatment; the menu resets to normal case, since it would
 * otherwise inherit the heading's `uppercase` and shout its options.
 */
export type ColumnOption = { key: string; label: string };

export function ColumnPicker({
  options,
  activeKey,
  open,
  onToggle,
  onSelect,
  className = "",
  wrapperClassName = "",
}: {
  options: ColumnOption[];
  /** The selected metric's key; falls back to the first option if unknown. */
  activeKey: string;
  /** Whether this column's menu is open — one at a time across the panel. */
  open: boolean;
  /** Toggle this column's menu (the panel closes any other that was open). */
  onToggle: () => void;
  /** Point this column at another metric. */
  onSelect: (key: string) => void;
  /** Applied to the trigger — the heading cell sets the font size here. */
  className?: string;
  /**
   * Applied to the heading *cell* rather than the trigger, for the display and
   * placement rules a grid column needs — the standings hides its second column
   * below @lg with `hidden @lg:inline-flex`, which has to reach this element
   * because it is the grid item.
   */
  wrapperClassName?: string;
}) {
  const active = options.find((o) => o.key === activeKey) ?? options[0];

  return (
    <span className={`relative inline-flex justify-self-end ${wrapperClassName}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`group/pick inline-flex items-center gap-0.5 whitespace-nowrap uppercase tracking-wide transition-colors ${
          open ? "text-foreground/80" : "text-foreground/40 hover:text-foreground/70"
        } ${className}`}
      >
        <span>{active.label}</span>
        <span
          aria-hidden="true"
          className={`text-[8px] leading-none transition-opacity ${
            open ? "opacity-100" : "opacity-0 group-hover/pick:opacity-100"
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[8rem] rounded-lg border border-foreground/15 bg-[var(--background)] p-1 normal-case tracking-normal shadow-[0_18px_44px_-14px_rgba(0,0,0,0.9)]"
        >
          {options.map((option) => {
            const isActive = option.key === active.key;
            return (
              <button
                key={option.key}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => onSelect(option.key)}
                className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? "bg-active/15 text-active"
                    : "text-foreground/75 hover:bg-foreground/10 hover:text-foreground"
                }`}
              >
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
