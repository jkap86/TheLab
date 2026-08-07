import type { ManagerLeague } from "@/shared/manager";

// The module path rather than `features/shared`'s barrel — a leaf part either
// way, but the card's own imports are all module paths and a barrel here would
// be the one arrow pointing at everything that barrel re-exports.
import { NAMEPLATE_BUTTON, Nameplate } from "@/features/shared/ui/nameplate";

import { leagueSpecs } from "../../league-specs";
import {
  SPEC_RUN,
  SPEC_TOKEN,
  SPEC_TONE,
  TRADE_HEADER_LINE,
} from "./trade-card.constants.ts";
import { formatTradeDate, formatTradeTime } from "./trade-card.utils.ts";

/**
 * What the card says about itself before a single asset is read: which league
 * this happened in, what kind of league that is, and the instant it went
 * through.
 *
 * **The name is on the edge and the rest is on the first interior line.** The
 * league's name rides *out* of the card on a nameplate ({@link TradeNameplate}),
 * because a part rising from an edge is the strongest mark for "one object"
 * available and the name is what a card is looked up by; the instant keeps a
 * line of its own inside the face ({@link TradeHeaderLine}). Folding the two into
 * the plate fits and was tried — one part carrying both facts costs nothing
 * vertically — but a league name long enough to truncate takes the timestamp
 * with it, and the instant is the card's answer to "which of this afternoon's
 * five deals landed first". A line is what that is worth.
 *
 * **The league's settings joined that line rather than the plate**, for the same
 * reason and the mirror of it: they are facts about the league, so the plate is
 * where they belong semantically, and the plate is the one part on this card
 * with no room to spare — every token would come straight out of the name's
 * truncation budget. The interior line had an empty half beside a right-flushed
 * timestamp, which is exactly the width six short tokens need.
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
 * The card's first interior line: what kind of league this was, and when the
 * trade went through.
 *
 * The instant is flush right, on the same edge every value below it sits on and
 * diagonally opposite the nameplate, so the two facts hold the card's corners
 * rather than crowding one of them. The specs fill the half that was empty
 * beside it. Both are readouts — recessed, because they are read and not
 * pressed — which is why they read as one strip rather than as a control run
 * with a timestamp stuck on the end.
 *
 * See {@link TRADE_HEADER_LINE} for why the two stack below `sm` instead of
 * sharing one wrapping row, and {@link SPEC_TOKEN} for why none of this is a
 * chip.
 */
export function TradeHeaderLine({
  league,
  completedAt,
}: {
  /**
   * The league this trade happened in, or null while the league list is still
   * in flight — which draws no specs rather than guessing at any of them.
   */
  league: ManagerLeague | null;
  /** Epoch milliseconds, or null for a trade Sleeper filed with no timestamp. */
  completedAt: number | null;
}) {
  const specs = leagueSpecs(league);

  return (
    // Reversed at width, so the instant keeps the trailing edge with the specs
    // pushed left by their own `mr-auto`. DOM order is instant-first for that.
    <header className={TRADE_HEADER_LINE}>
      {/* The date and the clock time are two functions and one reading — see
          `formatTradeTime`, which carries its own separator so a trade with no
          timestamp leaves nothing dangling after the words that say so. */}
      <span className="lab-readout self-end shrink-0 rounded px-2 py-0.5 text-[11px] tabular-nums text-foreground/60">
        {formatTradeDate(completedAt)}
        {formatTradeTime(completedAt)}
      </span>

      {/* Nothing at all rather than an empty box: a league the list hasn't
          answered for has no settings to report, and a row of em dashes would
          be reporting six holes instead of one absence. */}
      {specs.length > 0 && (
        <div className={SPEC_RUN}>
          {specs.map((spec) => (
            <span
              key={spec.key}
              title={spec.title}
              className={`${SPEC_TOKEN} ${SPEC_TONE[spec.tone]}`}
            >
              {spec.label}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
