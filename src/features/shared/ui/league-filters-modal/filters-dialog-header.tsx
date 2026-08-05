/**
 * What the panel is, and the way out of it.
 *
 * The title carries the id the `<dialog>` names in `aria-labelledby`, so the two
 * are a matched pair — and it is **passed in** rather than written here, because
 * two of these dialogs are on the page at once: the manager Leagues tab renders
 * one in the header plate's corner and the shares sheet opened from its rail
 * renders a second. Written literally, both pointed their `aria-labelledby` at
 * whichever heading came first in the document.
 */
export function FiltersDialogHeader({
  titleId,
  onClose,
}: {
  titleId: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-foreground/10 bg-gradient-to-b from-foreground/[0.05] to-transparent px-5 py-4">
      <h2 id={titleId} className="text-base font-semibold tracking-tight">
        Filter leagues
      </h2>
      {/*
        A close button rather than the `Esc` legend that used to sit here:
        the legend named a key a pointer can't press, on the one control in
        the panel a reader is most likely to reach for by hand. It wears
        `.lab-chip` at the quick-adds' half thickness — dismissing is a
        lesser press than Apply — and closing discards the draft on exactly
        the terms Escape does, since the draft is reseeded on open.
      */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="lab-chip lab-chip-sm ml-auto grid size-7 place-items-center rounded-full text-foreground/55 transition-colors hover:text-active"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}
