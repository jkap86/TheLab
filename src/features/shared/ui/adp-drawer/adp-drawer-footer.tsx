import { type AdpControls, previewAdpPool } from "../../adp-controls";

/**
 * The way out, and the board's own premise.
 *
 * The value column has one the ADP beside it doesn't: this board belongs to no
 * league, so the curve is anchored to an assumed pool. A number priced on an
 * assumption says which one.
 */
export function AdpDrawerFooter({
  teams,
  onReset,
  onClose,
}: {
  teams: AdpControls["teams"];
  /** Back to the default board — held by the store, which owns what "default" is. */
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <footer className="flex items-center gap-3 border-t border-foreground/10 bg-foreground/[0.015] px-4 py-2.5">
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm font-medium text-foreground/75 transition-colors hover:border-foreground/25 hover:text-foreground"
      >
        Reset
      </button>
      <p className="min-w-0 flex-1 truncate text-xs text-foreground/35">
        This app’s crawled drafts, not market ADP · values on a{" "}
        {previewAdpPool(teams)}-slot pool
      </p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-active/35 bg-active/[0.08] px-3 py-1.5 text-sm font-semibold text-active transition-colors hover:bg-active/[0.16]"
      >
        Done
      </button>
    </footer>
  );
}
