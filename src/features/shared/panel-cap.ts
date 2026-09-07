/**
 * How much of the viewport an open card's expanded panel may take.
 *
 * **Pure and in a `.ts` of its own so it can be tested**, which is the whole
 * reason it does not live beside the component that calls it: every term here
 * is a measurement the caller takes, and the arithmetic between them is the
 * thing that renders perfectly while being wrong. A number that is 500px too
 * small produces a panel with a scroller in it and no error to say so.
 *
 * **Two arms, because two cards park differently and one subtraction cannot
 * describe both.** See {@link panelCap}.
 */

/**
 * Breath under the panel, so the housing does not sit flush against the fold.
 * Both arms spend it; only the parked arm spends it against a header.
 */
const BREATH = 16;

/**
 * The parked arm's floor: **what the panel's own parts need, not a round
 * number.** The history bay is ~72px with its margin, a pane's ledge ~62, and
 * the roster pane's two pinned bars 88 — so under about 320px the glass is
 * shorter than the bars standing on it and the drawer has nowhere to open.
 * Below the floor the panel is simply taller than the space and the page
 * scrolls to it, which is the behaviour the cap replaces and is the right thing
 * to fall back to: a capped panel that cannot show a row is worse than an
 * uncapped one.
 */
const MIN_PARKED = 320;

/**
 * The un-parked arm's floor, and it is higher for a reason that is not
 * generosity. A card that never parks is scrolled to by the reader rather than
 * by the app, so the panel is what they are looking at and the header above it
 * is off screen as often as not — where the parked arm's floor is reached only
 * on a viewport too short to hold a header *and* a panel, which is a genuinely
 * cramped case. 460px is the bay, two ledges, the bars and three or four rows
 * of each list.
 */
const MIN_UNPARKED = 460;

/**
 * The share of a short viewport the un-parked arm will take, and the fixed
 * margin it leaves on a tall one. Whichever is smaller wins: the fraction is
 * what keeps a panel from swallowing a 700px window whole, and the subtraction
 * is what stops a 1400px one from opening a panel a reader has to scroll
 * *within* to reach the bottom of a list that would have fitted.
 */
const UNPARKED_SHARE = 0.7;
const UNPARKED_MARGIN = 120;

/** Which of the two shapes a card is — see {@link panelCap}. */
export type PanelCapMode =
  | {
      /**
       * The card scrolls its own top edge to `--card-freeze-top` on open and
       * freezes its header there, so what is left of the viewport is the
       * viewport less that offset, less the header, less breath. The manager
       * and lineup-checker cards.
       */
      parked: true;
      /**
       * How far the panel's own top edge sits below the card's — the header's
       * height *and* the panel's margin above it, measured as one distance
       * rather than summed from two. A margin read separately is a second
       * number to keep in step with a stylesheet, and the symptom of getting it
       * wrong is a panel that overhangs the fold by exactly that margin.
       */
      panelOffset: number;
      /** `--card-freeze-top` in px, read off the card. */
      freezeTop: number;
    }
  | {
      /**
       * The card neither parks nor freezes, so neither subtraction applies.
       * The trade card.
       */
      parked: false;
    };

/**
 * The panel's maximum height, in px.
 *
 * **The parked arm subtracts what is actually above the panel**: the frozen
 * header sits at `--card-freeze-top` and stays there, so the panel's ceiling is
 * whatever the viewport has left under it. Every term is on screen at once,
 * which is what makes the subtraction meaningful.
 *
 * **The un-parked arm subtracts nothing, and that is the correction rather than
 * a simplification.** A trade card carries both hauls in full — measured 413px,
 * against the ~210px of plates, strip and rank windows a manager card freezes —
 * so it does not park (a header that large frozen under the rack covers the top
 * half of the screen, with the history bay the first thing beneath it) and it
 * does not freeze. Run through the parked arm anyway, its ~428px panel offset
 * plus the freeze offset takes **515px** off the screen for two things that are
 * not there: measured, that hits the floor at an 800px viewport and leaves the
 * starters scroller 0px — nine seats behind two pinned bars. So the un-parked
 * arm asks the only question that is still true of that card, which is how much
 * of the *viewport* a panel may occupy: 189 / 259 / 330 / 456px of starters
 * scroller at viewport 700 / 800 / 900 / 1080.
 */
export function panelCap(viewport: number, mode: PanelCapMode): number {
  if (!mode.parked) {
    return round(
      Math.max(
        MIN_UNPARKED,
        Math.min(viewport * UNPARKED_SHARE, viewport - UNPARKED_MARGIN),
      ),
    );
  }
  return round(
    Math.max(MIN_PARKED, viewport - mode.freezeTop - mode.panelOffset - BREATH),
  );
}

/**
 * A cap is a pixel count, so it is one.
 *
 * The un-parked arm multiplies, and `700 * 0.7` is `489.99999999999994` in
 * binary floating point — which is invisible as a `max-height` and is a
 * fraction of a pixel of noise in anything that reads the number back. Both
 * arms round, so there is one rule rather than an arm that happens to be
 * integral because its inputs were.
 */
function round(px: number): number {
  return Math.round(px);
}
