/**
 * Where the league filters' key is seated, and the box that holds its place.
 *
 * **This is split out from the dialog it belongs to so that the placeholder can
 * be static while the dialog is not.** `LeagueFiltersModal` is loaded through
 * `dynamic()` at both its call sites — it is a trigger and a `<dialog>`, and
 * nobody has opened the dialog at first paint — but something has to occupy the
 * trigger's box until the chunk arrives, or the header plate's corner and the
 * trades board's controls row both reflow when it lands. A fallback that lived in the
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
 * `free` stands on a page — the trades board's controls row, where nothing
 * bounds it, so it is the pill `.lab-chip` was written for. `corner` is machined into the bottom
 * right of the manager header's plate: two of its corners are square because
 * they meet the plate's own edges, the outer one takes the plate's `rounded-2xl`
 * so it traces that corner exactly, and the inner one is the small return the
 * plate's top tabs already use. It runs at those tabs' type scale rather than
 * the pill's for a plain geometric reason — the plate's bottom padding is what
 * holds it clear of the win-pct dial above it, and at `text-sm` the part is
 * 32px tall and crosses the dial instead.
 *
 * `bar` rides in the shares sheet's title bar, beside a search field and a close
 * mark. It is `free`'s pill at the smaller of the two type scales, because a
 * title bar is a row of parts rather than a page: at the pill's own size it out-
 * weighed the sheet's title, and it has to line up with a 28px field rather than
 * with a plate's edge, so it keeps the round corners and drops a step.
 *
 * `rail` leads the manager tabs' subject rail — the *what these leagues are*
 * half of a row whose other half is *who is in them*. It is the two shares keys'
 * exact box, and being exact is the whole of it: three keys on one milled face,
 * one of them a step larger, is a row that reads as a mistake before it reads as
 * a hierarchy. So it takes their 10px type, their padding, and — the one place a
 * seat reaches past shape — their `.lab-chip-sm` wall.
 *
 * **That thickness is the exception this table's own rule has to make room
 * for.** Everywhere else the seats differ only in the edge they meet, because
 * everywhere else the key is the only part of its kind in view; here it is the
 * first of three on one surface, and a wall a pixel prouder than its neighbours'
 * is the same fault as a corner key that overhangs. It changes nothing about
 * what the part *says*: the cyan face still means narrowing, the badge still
 * carries the count, and `.lab-chip-on.lab-chip-sm` in `globals.css` is what
 * keeps the lit state at that wall too.
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
  bar: {
    key: "gap-1.5 rounded-full py-1 pl-2.5 pr-3 text-[11px] leading-none",
    icon: "h-3 w-3",
    badge: "px-1 py-px text-[10px]",
  },
  rail: {
    // `lab-chip-sm` rides in the shape string because that is where the trigger
    // composes it — see the note above for why this seat is allowed the wall.
    key: "lab-chip-sm gap-1.5 rounded-full px-2 py-[3px] text-[10px] leading-none",
    icon: "h-3 w-3",
    // A step under `bar`'s, since the key it sits on is a step under `bar`'s
    // too: a badge is read against the word beside it, not at a fixed size.
    badge: "px-1 py-px text-[9px]",
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
