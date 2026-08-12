import type { ManagerLeague } from "@/shared/manager";

// The module path rather than `features/shared`'s barrel — a leaf part either
// way, but the card's own imports are all module paths and a barrel here would
// be the one arrow pointing at everything that barrel re-exports.
//
import { leagueSpecs } from "@/features/shared/league-specs";
import { LeagueSpecsBezel } from "@/features/shared/ui/league-specs";
// `ui/nameplate` and not `ui/league-card`: the ledge is re-exported from there
// for the two lists that already read it, and that module statically imports the
// whole league-detail subtree — which this page keeps behind a press.
import {
  CardLedge,
  NAMEPLATE_BUTTON,
  Nameplate,
} from "@/features/shared/ui/nameplate";

import { TRADE_HEADER_LINE } from "./trade-card.constants.ts";
import { formatTradeDate, formatTradeTime } from "./trade-card.utils.ts";

/**
 * What the card says about itself before a single asset is read: which league
 * this happened in, what kind of league that is, and the instant it went
 * through.
 *
 * **The two facts hold the top edge and the settings have the line below it.**
 * The league's name rides out of the card on a nameplate ({@link TradeNameplate})
 * and the instant rides beside it on a plate of its own
 * ({@link TradeInstantLedge}), so the card's two corners carry which league this
 * is and when it happened.
 *
 * **The instant used to keep a line of its own inside the face, and the note
 * here used to argue that it had to.** The argument was that folding it into the
 * plate costs nothing vertically but a league name long enough to truncate takes
 * the timestamp down with it — which is true of *one* plate carrying both facts
 * and is not true of two plates sharing the edge. A plate that positions itself
 * can only cap its own width; two items of one flex row negotiate, so the name
 * truncates against the instant rather than against a width guessed ahead of it.
 * That construction is the leagues list's (see `CardLedge`), and adopting it is
 * what freed the whole interior line.
 *
 * **The league's settings took that line**, which is what let them become one
 * housed instrument rather than a run of tokens squeezed into the ~180px beside
 * a right-flushed timestamp. They are still not on the plate, for the reason
 * they never were: it is the one part on this card with no room to spare, and
 * every gauge would come out of the name's truncation budget.
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
    // `row`, because this edge carries a second part: the plate is an item of the
    // row the card positions, so the name truncates against the instant rather
    // than against a width guessed ahead of it.
    <Nameplate seat="row">
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
 * When the trade went through, on the plate holding the card's trailing corner.
 *
 * **It is the leagues list's record ledge with a different fact in it**, down to
 * the grammar inside: the primary reading sits in a `.lab-readout` cut and the
 * secondary one is engraved beside it, which is exactly how a record and its
 * standing sit together one tool over. A cut into the plate's lit face is
 * machining, so the part reads as a housing around an instrument rather than as a
 * second label — which is what keeps it from competing with the league's name on
 * the same edge.
 *
 * **The date is the cut and the time is engraved**, in that order, because they
 * answer different questions. The date is what a reader is placing the trade by;
 * the clock time is the tiebreaker between an afternoon's five deals, which is
 * the whole reason it exists (see {@link formatTradeTime}) and is worth less
 * width than the date it follows.
 *
 * **An undated trade still draws the plate**, which is where this parts company
 * with the record ledge — that one renders nothing rather than an empty housing.
 * Here the absence *is* the answer: a trade Sleeper filed with no timestamp is
 * dropped by every date bound on this board, so a reader who cannot find it in a
 * window has been told why. It says so in words rather than as an em dash, and
 * the time simply is not drawn — the separator that used to keep that honest
 * belonged to a one-line spelling and is gone with it.
 */
export function TradeInstantLedge({
  completedAt,
}: {
  /** Epoch milliseconds, or null for a trade Sleeper filed with no timestamp. */
  completedAt: number | null;
}) {
  const time = formatTradeTime(completedAt);
  return (
    <CardLedge>
      <span className="lab-readout shrink-0 rounded px-1.5 py-px text-[11.5px] font-semibold leading-4 tabular-nums text-foreground/85">
        {formatTradeDate(completedAt)}
      </span>
      {time && (
        <span className="lab-engraved shrink-0 text-[10.5px] font-semibold leading-4 tabular-nums text-foreground/70">
          {time}
        </span>
      )}
    </CardLedge>
  );
}

/**
 * The card's first interior line: what kind of league this was, as one bezel of
 * gauges.
 *
 * **The bezel itself is `features/shared/ui/league-specs`**, since the manager
 * tool's leagues list draws the same run on its own cards — the mover's rule, and
 * moving the derivation without the drawing would have been half a move. What is
 * left here is the *line*: which is all this card ever contributed, and is
 * exactly what the other caller does not want, since a league card has a head
 * with room in it and this one has a face that is otherwise all sides.
 *
 * **The run is derived here rather than inside the bezel**, which is what lets
 * the line be dropped whole. An empty `<header>` is still 8px of padding under a
 * nameplate, so this card has to know there is nothing to draw *before* it draws
 * the wrapper — where the leagues list, seating the part in a head that exists
 * either way, only needs the bezel's own null.
 */
export function TradeHeaderLine({
  league,
}: {
  /**
   * The league this trade happened in, or null while the league list is still
   * in flight — which draws no specs rather than guessing at any of them.
   */
  league: ManagerLeague | null;
}) {
  const specs = leagueSpecs(league);

  // Nothing at all rather than an empty line: a league the list hasn't answered
  // for has no settings to report, and a bezel of em dashes would be reporting
  // six holes instead of one absence.
  if (specs.length === 0) return null;

  return (
    <header className={TRADE_HEADER_LINE}>
      <LeagueSpecsBezel specs={specs} />
    </header>
  );
}
