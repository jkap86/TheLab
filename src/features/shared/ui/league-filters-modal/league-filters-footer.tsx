/**
 * The way back to the default selection, the count restated where the rail
 * isn't, and Apply.
 *
 * It sits below the scroll box rather than in it, so Apply is reachable whatever
 * the panel is showing: on a wide host nothing needs to scroll at all, which is
 * the point of the two-column bay, and everywhere narrower — a phone, and the
 * ADP drawer's Leagues bay at every width — the whole grid is one column and
 * this is the only thing holding its place.
 *
 * The width it asks about is its **container's**, not the viewport's, which is
 * what lets one footer serve both hosts: `@4xl` measures the panel it is part
 * of, so a 1040px dialog on a laptop hides the count (the rail beside the
 * controls is carrying it) and a ~450px drawer bay on the same laptop shows it.
 */
export function LeagueFiltersFooter({
  matched,
  total,
  hintId,
  className,
  onReset,
  onApply,
}: {
  /** How many leagues the *draft* leaves — the same walk the rail reads. */
  matched: number;
  total: number;
  /**
   * The host's `aria-describedby` target — the rule the whole panel encodes,
   * stated on arrival rather than found in a footer.
   *
   * Optional, because only a host with a box of its own to describe can point at
   * it: the dialog does, and the drawer's bay is a group inside a dialog already
   * describing the board. Unreferenced, the sentence is still in the document and
   * still read in its place.
   */
  hintId?: string;
  /** The seat's own box — see `PANEL_SEATS`, which is where the two are written. */
  className?: string;
  onReset: () => void;
  onApply: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 border-t border-foreground/10 bg-gradient-to-b from-transparent to-black/25 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={onReset}
        className="rounded-lg border border-foreground/10 px-4 py-2 text-sm font-semibold text-foreground/60 transition-colors hover:border-foreground/25 hover:text-foreground"
      >
        Reset
      </button>
      {/*
        The count lives in the rail, which is beside the controls only once
        there is room for it. Below that width the rail is stacked at the
        bottom of a scrolling panel, so the footer states the number again
        — same `matched`, so the two can't disagree.
      */}
      <span className="text-sm text-foreground/60 @4xl:hidden">
        <b className="font-semibold tabular-nums text-foreground">{matched}</b> of{" "}
        {total} match
      </span>
      {/* `sr-only` beside the `@4xl:inline` copy rather than an id on that copy:
          it is `display: none` below that width, where a description referencing
          it would resolve to nothing at exactly the width the rail is stacked out
          of sight. */}
      <span id={hintId} className="sr-only">
        Every filter narrows — a league has to pass all of them.
      </span>
      <span
        aria-hidden="true"
        className="hidden text-xs text-foreground/40 @4xl:inline"
      >
        Every filter narrows — a league has to pass all of them.
      </span>
      <button
        type="button"
        onClick={onApply}
        className="ml-auto rounded-lg bg-active px-4 py-2 text-sm font-bold text-[#04141a] shadow-[0_0_24px_-6px_rgba(0,255,229,0.7)] transition-[filter] hover:brightness-110"
      >
        Apply
      </button>
    </div>
  );
}
