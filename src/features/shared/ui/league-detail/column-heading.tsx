"use client";

/**
 * A column heading that doubles as the way to change the column: the current
 * metric's label with a caret, opening the panel's columns editor armed on this
 * slot.
 *
 * **It used to hang a menu of its own, and the menu is what went.** A flat list
 * of the whole catalogue under whichever label was pressed is the right control
 * for changing one column and the wrong one for changing the table: it could show
 * no preview of what a column would say, offer no named pair, and say nothing
 * about which other slot already held the metric being picked — so a reader
 * recomposing both columns made two passes over the same list with nothing to see
 * until the second landed. It is the same trade the leagues list made when its
 * per-column menus became {@link ColumnsEditor}, and this panel is the last place
 * that pattern survived. Pressing a heading here now opens the dialog *at that
 * heading's slot*, which is one gesture answering both "change this column" and
 * "change the table".
 *
 * That leaves this a button and nothing else — no open state, no outside-click,
 * no menu overhanging the rows beneath it. The dialog is in the top layer, so the
 * two halves no longer lift their stacking order over each other and neither has
 * to stay unclipped for a menu's sake.
 *
 * The trigger inherits its font size from the heading cell it sits in and only
 * sets the uppercase treatment, which is why that is a default here rather than
 * hardcoded below.
 */
export function ColumnHeading({
  label,
  onOpen,
  className = "uppercase tracking-wide",
}: {
  /** The selected metric's label — the column's only name. */
  label: string;
  /** Open the editor armed on this column's slot. */
  onOpen: () => void;
  /**
   * Applied to the trigger — the heading's size *and its type treatment*.
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
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      // The full label, in case a catalogue ever grows one past the column's
      // width — a truncated heading is the only name its column has.
      title={label}
      // 50% rather than 40% at rest: these labels are the smallest strings in
      // the panel and the only name a column of bare numbers has, so they are
      // the last thing that should be fading into the plate. One place, because
      // both halves' rails are this component.
      className={`group/pick inline-flex min-w-0 items-center justify-self-end gap-0.5 whitespace-nowrap text-foreground/50 transition-colors hover:text-foreground/80 ${className}`}
    >
      <span className="truncate">{label}</span>
      {/* Always drawn, dim at rest. On `group-hover` alone it never appeared on
          a touch device, which left the control that changes the column with
          nothing at all to say it was one. */}
      <span
        aria-hidden="true"
        className="text-[8px] leading-none text-foreground/25 transition-colors group-hover/pick:text-foreground/60"
      >
        ▾
      </span>
    </button>
  );
}
