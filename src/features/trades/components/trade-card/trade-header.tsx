import { formatTradeDate, formatTradeTime } from "./trade-card.utils.ts";

/**
 * What the card says about itself before a single asset is read: which league
 * this happened in, and the instant it went through.
 *
 * **They are two parts now, on opposite sides of the card's top edge.** The
 * league's name rides *out* of the card on a nameplate ({@link TradeNameplate}),
 * because a part rising from an edge is the strongest mark for "one object"
 * available and the name is what a card is looked up by; the instant keeps a
 * line of its own inside the face ({@link TradeInstant}). Folding the two into
 * the plate fits and was tried — one part carrying both facts costs nothing
 * vertically — but a league name long enough to truncate takes the timestamp
 * with it, and the instant is the card's answer to "which of this afternoon's
 * five deals landed first". A line is what that is worth.
 */

/**
 * The league's name, on a plate straddling the card's top edge.
 *
 * It renders as a **sibling of the slab, never a child**: `clip-path` clips its
 * whole subtree, so a plate inside the notched face would be cut off at the
 * exact edge it exists to straddle. The overhang is padding on the wrapper
 * rather than a negative margin, which is what keeps it inside the box
 * `TradesList` measures — a part hanging outside that box drifts every card
 * below it down the list.
 */
export function TradeNameplate({
  name,
}: {
  /** The league's name, or the id standing in until the league list answers. */
  name: string;
}) {
  return (
    <div className="lab-nameplate absolute left-3.5 top-0 z-10 flex max-w-[calc(100%-3rem)] items-center gap-2 rounded-[5px] py-[3px] pl-2 pr-2.5">
      <span
        aria-hidden="true"
        className="lab-billet-rail h-3.5 w-0.5 shrink-0 rounded-sm"
      />
      {/* `h2`: the page's own title is a visually-hidden `h1` (the ledge is what
          leads it on screen), so a card is the next level down and a 3 here
          skipped one. A step down in size from the 13px it wore on the face,
          since the plate is sized to the name rather than to the card. */}
      <h2 className="min-w-0 truncate font-display text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/85 [text-shadow:0_1px_0_rgba(255,255,255,0.12),0_-1px_1px_rgba(0,0,0,0.9)]">
        {name}
      </h2>
    </div>
  );
}

/**
 * When the trade went through, on the card's first interior line.
 *
 * Flush right, on the same edge every value below it sits on and diagonally
 * opposite the nameplate, so the two facts hold the card's corners rather than
 * crowding one of them. It is a readout — recessed, because it is read and not
 * pressed.
 */
export function TradeInstant({
  completedAt,
}: {
  /** Epoch milliseconds, or null for a trade Sleeper filed with no timestamp. */
  completedAt: number | null;
}) {
  return (
    <header className="flex px-3 pb-2">
      {/* The date and the clock time are two functions and one reading — see
          `formatTradeTime`, which carries its own separator so a trade with no
          timestamp leaves nothing dangling after the words that say so. */}
      <span className="lab-readout ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] tabular-nums text-foreground/60">
        {formatTradeDate(completedAt)}
        {formatTradeTime(completedAt)}
      </span>
    </header>
  );
}
