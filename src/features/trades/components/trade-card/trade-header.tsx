// The module path rather than `features/shared`'s barrel — a leaf part either
// way, but the card's own imports are all module paths and a barrel here would
// be the one arrow pointing at everything that barrel re-exports.
import { NAMEPLATE_BUTTON, Nameplate } from "@/features/shared/ui/nameplate";

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
 * The league's name, on a plate straddling the card's top edge — and the card's
 * one focusable control.
 *
 * The plate itself is {@link Nameplate}, in `features/shared` since the leagues
 * list draws the same part: its box, its rail and the heading's type are shared,
 * and the *control* inside it is not, because the two open different things. What
 * that shared part is careful about — living outside the notched face's clip, and
 * hanging into padding rather than out of the card's measured box — is written
 * there.
 *
 * **It is the button, though the whole card is the target.** Pressing a card
 * opens that league's standings and rosters, and the obvious implementation —
 * `role="button"` on the card, the way the league cards' own row is written — is
 * wrong at this size: `button` takes presentational children, so a card holding
 * two manager blocks, a dozen asset lines and their values would be flattened to
 * one label for anyone reading it with assistive tech. So the *name* is a real
 * `<button>` and the card's wrapper carries only the click handler. Keyboard
 * activation of a button fires a click that bubbles, so one handler up there
 * serves both without either firing twice — and what a screen reader is offered
 * is the league's name, which is exactly what pressing it opens.
 *
 * The plate does not travel on press: it is a nameplate rather than a key, and
 * "raised means press me" belongs to the chips. What answers the pointer is the
 * card's own lift, which it already had.
 */
export function TradeNameplate({
  name,
}: {
  /** The league's name, or the id standing in until the league list answers. */
  name: string;
}) {
  return (
    <Nameplate>
      {/* The button sits *inside* the heading rather than around it, since a
          `<button>` takes phrasing content and a heading is flow — the same
          constraint that keeps the card's own press target off a `<button>`
          entirely. */}
      <button
        type="button"
        title="Standings and rosters for this league"
        className={NAMEPLATE_BUTTON}
      >
        {name}
      </button>
    </Nameplate>
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
