import { SEATS, type SeatName } from "../league-filters-seat";

/**
 * The key that opens the dialog, and the only part of this folder that is on
 * screen before anyone presses anything.
 *
 * It carries what a modal otherwise hides: the count of active filters, which
 * with the header's own summary is how the selection stays legible without the
 * bar of segments this dialog replaced. `LeagueFiltersPlaceholder` stands in for
 * its exact box while the chunk is in flight, which is why the seat metrics are
 * read from `SEATS` in both rather than spelled twice.
 */
export function FiltersTrigger({
  label,
  seat,
  active,
  onOpen,
}: {
  label: string;
  seat: SeatName;
  /** How many filters are narrowing the *applied* selection, not the draft. */
  active: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      // A raised part, because it is pressable — the app bar's grammar, in the
      // pill form `.lab-chip` carries. The cyan face is reserved for a filter
      // actually narrowing something, which is this button's one signal.
      className={`inline-flex items-center font-semibold ${SEATS[seat].key} ${
        active > 0 ? "lab-chip-on" : "lab-chip text-foreground/85"
      }`}
    >
      <FilterIcon dim={active === 0} size={SEATS[seat].icon} />
      {label}
      {active > 0 && (
        <span
          className={`rounded-[5px] bg-[#052029] font-bold leading-none text-active ${SEATS[seat].badge}`}
        >
          {active}
        </span>
      )}
    </button>
  );
}

function FilterIcon({ dim, size }: { dim: boolean; size: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`${size} ${dim ? "stroke-foreground/55" : "stroke-[#052029]"}`}
      fill="none"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M1.5 3.5h13M4 8h8M6.5 12.5h3" />
    </svg>
  );
}
