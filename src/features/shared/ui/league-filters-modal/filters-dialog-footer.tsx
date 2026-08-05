/**
 * The way back to the default board, the count restated where the rail isn't,
 * and Apply.
 *
 * It sits below the scroll box rather than in it: on a laptop nothing needs to
 * scroll at all, which is the point of the two-column bay, but on a phone the
 * whole grid collapses to one column and this is what keeps Apply reachable.
 */
export function FiltersDialogFooter({
  matched,
  total,
  hintId,
  onReset,
  onApply,
}: {
  /** How many leagues the *draft* leaves — the same walk the rail reads. */
  matched: number;
  total: number;
  /**
   * The dialog's `aria-describedby` target — the rule the whole panel encodes,
   * stated on arrival rather than found in a footer.
   */
  hintId: string;
  onReset: () => void;
  onApply: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-foreground/10 bg-gradient-to-b from-transparent to-black/25 px-5 py-4">
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
      <span className="text-sm text-foreground/60 lg:hidden">
        <b className="font-semibold tabular-nums text-foreground">{matched}</b> of{" "}
        {total} match
      </span>
      {/* `sr-only` beside the `lg:inline` copy rather than an id on that copy:
          it is `display: none` below `lg`, where a description referencing it
          would resolve to nothing at exactly the width the rail is stacked out
          of sight. */}
      <span id={hintId} className="sr-only">
        Every filter narrows — a league has to pass all of them.
      </span>
      <span aria-hidden="true" className="hidden text-xs text-foreground/40 lg:inline">
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
