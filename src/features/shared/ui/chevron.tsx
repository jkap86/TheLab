/**
 * The row-expander arrow. `md` is the league cards' size, `sm` the lists'.
 *
 * It is in `features/shared` because three lists in two tools draw it — the
 * leagues list's cards, the share cards inside both shares sheets, and the lineup
 * checker's own cards — and a disclosure mark that differs by a pixel between two
 * lists reads as two different controls. `features/manager/components/ui` keeps
 * the re-export its own consumers already import it by.
 */
export function Chevron({
  open,
  size = "sm",
}: {
  open: boolean;
  size?: "sm" | "md";
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${
        size === "md"
          ? "h-4 w-4 text-foreground/40"
          : "h-3.5 w-3.5 text-foreground/30"
      } ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
