"use client";

import { useId, useRef } from "react";

import { useReturnFocus } from "../../use-return-focus";

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
  className = "uppercase tracking-wide",
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
  /**
   * Applied to the trigger — the heading's size *and its type treatment*, which
   * is why the uppercase and the tracking are a default here rather than
   * hardcoded below.
   *
   * Both rails set sentence case at their narrow tiers, because a heading is
   * what sizes a fixed value track and the widest one doesn't fit: `Optimal`
   * measures 43.8px uppercase and tracked against a 42px standings track, where
   * sentence case is 33.1px. A caller that has to say that needs to say it
   * without fighting a utility the component already wrote — two
   * `text-transform` utilities on one element are decided by their order in the
   * stylesheet, not in the attribute.
   */
  className?: string;
}) {
  const active = options.find((o) => o.key === activeKey) ?? options[0];
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  // Escape and the outside-click both live in the panel that owns "one picker at
  // a time", so this menu is closed from outside itself — and a reader who had
  // tabbed onto one of its options is left on `body`.
  useReturnFocus(open, trigger);

  return (
    // `inline-flex` is the component's own now that no caller hides a heading:
    // both tables draw both value columns at every width, so the prop that used
    // to carry a cell's `display` — and the alphabetical-order trap that came
    // with it — has nothing left to express.
    <span className="relative inline-flex justify-self-end">
      <button
        ref={trigger}
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`group/pick inline-flex min-w-0 items-center gap-0.5 whitespace-nowrap transition-colors ${
          open ? "text-foreground/80" : "text-foreground/40 hover:text-foreground/70"
        } ${className}`}
      >
        <span>{active.label}</span>
        {/* Always drawn, dim at rest. On `group-hover` alone it never appeared on
            a touch device, which left the control that changes the column with
            nothing at all to say it was one. */}
        <span
          aria-hidden="true"
          className={`text-[8px] leading-none transition-colors ${
            open
              ? "text-foreground/80"
              : "text-foreground/25 group-hover/pick:text-foreground/60"
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`${active.label} column`}
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
