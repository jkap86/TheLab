/**
 * Where the league filters' key is seated, and the box that holds its place.
 *
 * **This is split out from the dialog it belongs to so that the placeholder can
 * be static while the dialog is not.** `LeagueFiltersModal` is loaded through
 * `dynamic()` at both its call sites — it is a trigger and a `<dialog>`, and
 * nobody has opened the dialog at first paint — but something has to occupy the
 * trigger's box until the chunk arrives, or the header plate's corner and the
 * trades ledge's row both reflow when it lands. A fallback that lived in the
 * dialog's own module would pull that module back into the static graph and
 * split nothing, which is the trap `AdpTrigger` was moved out of `AdpDrawer`'s
 * file to avoid.
 *
 * The seat table lives here rather than beside the dialog for the same reason
 * `COLUMN_BOX` is written once: the placeholder is standing in for the key's
 * exact box, so a second spelling of that geometry is a reflow waiting for
 * someone to edit one of them. The dialog imports it; nothing here imports the
 * dialog.
 */

/**
 * The two ways this trigger is mounted, and the only thing that varies between
 * them.
 *
 * A shared control with two looks is the drift `LeagueFiltersModal` exists to
 * prevent, so what a seat may change is *shape* and nothing else: the material
 * (`.lab-chip` / `.lab-chip-on`), the icon, the word and the count are the same
 * part in both. What differs is the edge it is seated against.
 *
 * `free` stands on a page — the trades ledge, where nothing bounds it, so it is
 * the pill `.lab-chip` was written for. `corner` is machined into the bottom
 * right of the manager header's plate: two of its corners are square because
 * they meet the plate's own edges, the outer one takes the plate's `rounded-2xl`
 * so it traces that corner exactly, and the inner one is the small return the
 * plate's top tabs already use. It runs at those tabs' type scale rather than
 * the pill's for a plain geometric reason — the plate's bottom padding is what
 * holds it clear of the win-pct dial above it, and at `text-sm` the part is
 * 32px tall and crosses the dial instead.
 */
export const SEATS = {
  free: {
    key: "gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-sm",
    icon: "h-3.5 w-3.5",
    badge: "px-1.5 py-0.5 text-[11px]",
  },
  corner: {
    key: "gap-1.5 rounded-br-2xl rounded-tl-lg py-1 pl-3 pr-3.5 text-[11px] leading-none",
    icon: "h-3 w-3",
    // `py-px`, so the badge is no taller than the icon beside it and the key is
    // the same 20px narrowed or not. A trigger seated in an edge must not change
    // height with its own state: it is anchored to that edge, so growing moves
    // its top into whatever the plate's bottom padding was holding it clear of.
    badge: "px-1 py-px text-[10px]",
  },
} as const;

export type SeatName = keyof typeof SEATS;

/**
 * The key's box while the dialog's chunk is in flight.
 *
 * Dimmed and inert rather than absent: it wears the unlit `.lab-chip` and the
 * seat's own metrics, so what arrives is the same part with its label lit, not a
 * part appearing where there was none. It states no count — a badge is what the
 * selection has to say, and the module that knows the selection is the one still
 * loading, so a number here would be invented.
 */
export function LeagueFiltersPlaceholder({
  label,
  seat = "free",
}: {
  label: string;
  seat?: SeatName;
}) {
  return (
    <span
      aria-hidden="true"
      className={`lab-chip inline-flex items-center font-semibold text-foreground/40 ${SEATS[seat].key}`}
    >
      {label}
    </span>
  );
}
