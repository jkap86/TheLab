import type { LeagueSpec } from "../league-specs.ts";

/**
 * What kind of league this is, as one bezel of gauges.
 *
 * **Each fact is a value in a window with its unit cut into the floor above
 * it**, which is the one spelling that tells a reader what `1QB + SF` is a count
 * of without a hover — and there is no hover on a phone, which is the width the
 * run is tightest at. That is what the whole part is for; everything else about
 * it follows from making a run of six read as one instrument (see
 * {@link SPEC_BEZEL}).
 *
 * **Nothing here is a chip.** The app bar's grammar is that raised means press
 * me, and six raised pills per card across the couple of dozen a windowed list
 * keeps mounted is a hundred and fifty apparent controls that do nothing. Both
 * of this part's depths run *downward* for exactly that reason.
 *
 * **It is in `features/shared/ui` because a second list wears it**, and moving
 * the derivation without the drawing would have been half a move: a bezel is six
 * class strings and an index-applied seam, and a second copy of that is two
 * answers to "what does a league's settings look like". So the trade card's
 * first interior line and the league card's head render one part, and the only
 * thing either caller decides is where it sits.
 *
 * **It takes the run rather than the league**, which is what lets a caller wrap
 * it in something of its own: the trade card gives it a line, and a line with an
 * empty bezel in it is still 8px of padding, so that card has to know there is
 * nothing to draw *before* it draws the wrapper. Deriving the run is
 * {@link leagueSpecs}' job either way, and it is pure — so asking it twice to
 * find out would be the cost of a component that hid the answer.
 */
export function LeagueSpecsBezel({
  specs,
}: {
  /** The run, from {@link leagueSpecs} — empty draws nothing at all. */
  specs: LeagueSpec[];
}) {
  // Nothing rather than an empty bezel: a league the list hasn't answered for
  // has no settings to report, and a housing of em dashes would be reporting six
  // holes instead of one absence.
  if (specs.length === 0) return null;

  return (
    <div className={SPEC_BEZEL}>
      {specs.map((spec, i) => (
        <span
          key={spec.key}
          title={spec.title}
          // The seam is applied by index rather than by an adjacent-sibling
          // selector, which Tailwind has none of — the same arithmetic the trade
          // card's sides use, and for the same reason.
          className={`${SPEC_BAY} ${i === 0 ? "" : SPEC_SEAM}`}
        >
          <span className={SPEC_CAPTION}>{spec.caption}</span>
          <span className={`${SPEC_GAUGE} ${SPEC_TONE[spec.tone]}`}>
            {spec.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * The bezel the specs sit in: one trough milled into the card's face.
 *
 * **The run is one part, and that is the whole change.** Six separate housings
 * read as perforation in the face rather than as one fact about the league, and
 * nothing in a run of six identical pills is easier to find than anything else.
 * Housed, it is a single object a reader learns the shape of once.
 *
 * `inline-flex` so the part is as wide as the league's own settings rather than
 * the card — a housing that reached both walls would have to be *filled*, and a
 * four-token redraft league would leave two thirds of it empty. It wraps, which
 * is what a phone gets: two rows inside one bezel rather than a run that
 * overflows, since the seam below is drawn by index and survives the wrap as the
 * housing's own inner edge.
 *
 * **A wrapped bezel is full width, so on a phone that argument was being made
 * and then broken.** `max-w-full` on a shrink-to-fit box resolves to the full
 * width the moment the content exceeds it, and six gauges do not fit a phone at
 * any honest spelling — measured against the real face, the widest run is 415px
 * against the 336 a 415px screen leaves. So the housing *did* reach both walls,
 * with a last row holding one gauge and two thirds of a lit trough holding
 * nothing, which reads as a hole in the part rather than as a part.
 *
 * The fix is the one the comment above already names: fill it. {@link SPEC_BAY}
 * grows, so each row shares out whatever its own line has left and the bays tile
 * the trough edge to edge. It is **a no-op wherever the run fits** — a
 * shrink-to-fit box has no free space to distribute — so nothing changes on a
 * laptop, or on a phone for the four- and five-gauge leagues that now stay on
 * one row. What it changes is only the case that was already broken.
 *
 * The material and its two depths are `.lab-bezel` in `globals.css`, per the
 * rule that a `.lab-*` class carries material and never layout.
 */
export const SPEC_BEZEL =
  "lab-bezel inline-flex max-w-full flex-wrap rounded-[5px] px-1 pb-1 pt-[3px]";

/**
 * One gauge's box: the caption over the value it names.
 *
 * A region of the bezel's floor rather than a part seated in it — no fill, no
 * wall, no radius. That is the trade card's own rule about sides applied one
 * scale down: giving each bay a face would be a third countable depth inside a
 * part that already has two, and nothing inside the housing is built like a part
 * for the same reason nothing inside the card is built like a card.
 *
 * **`grow` and not `flex-1`, which is the whole of what makes it safe.**
 * `flex-1` sets a basis of zero, and a flex container's own max-content width is
 * computed from its items' bases — so the bezel would stop being as wide as the
 * league's settings and every bay would come out the same width. `grow` leaves
 * the basis on the content, so the bezel measures exactly what it always did and
 * the growth only ever spends free space a wrap has already created. See
 * {@link SPEC_BEZEL}.
 */
export const SPEC_BAY =
  "flex min-w-0 grow flex-col gap-px px-[0.3125rem] pb-[3px] pt-0.5";

/**
 * The cut parting one gauge from the one before it — the card's own milled seam
 * (`SIDE_SEAM_VERTICAL`) at gauge scale, applied by index at the call site
 * because Tailwind has no adjacent-sibling selector and the first bay must not
 * wear one.
 *
 * Dimmer than the seam between two of a trade's sides: this one is inside a
 * recess, where there is less light to catch, and a seam as strong as the card's
 * own would claim the gauges are as separate from each other as two managers'
 * hauls are.
 */
export const SPEC_SEAM =
  "shadow-[inset_1px_0_0_rgba(0,0,0,0.65),inset_2px_0_0_rgba(255,255,255,0.05)]";

/**
 * The caption, cut into the bezel's floor.
 *
 * `.lab-engraved-faint` rather than the full-strength cut, which is the rule
 * that class exists for: the highlight is a fixed 1px whatever the type size, so
 * at 6px the strong lower lip is most of the stroke weight and reads as a blur.
 *
 * At 6px it is the smallest type in the app and it earns that by being a *unit*
 * rather than a word to read — `TEAMS` over `12 TEAM` is recognised at a glance
 * and never parsed, which is what lets it go this small. `whitespace-nowrap`
 * because a caption that wraps is taller than the value it names and the gauges
 * would stop lining up.
 */
export const SPEC_CAPTION =
  "lab-engraved-faint text-center font-display text-[0.375rem] font-bold uppercase leading-[0.5rem] tracking-[0.2em] text-foreground/35";

/**
 * The value, in a window sunk into the bezel's floor.
 *
 * On the display face at 9.5px — a hair under the 10px a trade's asset values
 * wear, the rule a named row already follows, since Orbitron is wide and six of
 * these have to fit a phone. The glass and the lit lower lip are `.lab-gauge`.
 */
export const SPEC_GAUGE =
  "lab-gauge rounded-[3px] px-[0.4375rem] text-center font-display text-[0.59375rem] font-bold uppercase leading-[0.875rem] tracking-[0.04em] tabular-nums whitespace-nowrap";

/**
 * How brightly a value is drawn, per {@link LeagueSpec.tone}.
 *
 * One step between them and no more. What game this is — the type, best ball —
 * changes what a trade means, so it reads first; the lineup and scoring detail
 * describes the room it happened in. Both stay well under whatever the card
 * ranks above them, which is what the eye should reach next: a manager's name on
 * a trade card, the four stat columns on a league card.
 *
 * **Both are the `foreground` token and neither is tinted.** A cyan-white
 * numeral was the obvious spelling and is the wrong one twice over: it has no
 * token to read, and the accent is already spent in every gauge's lower lip —
 * putting it in the type as well would light the numerals of the fact each card
 * ranks last.
 */
export const SPEC_TONE: Record<LeagueSpec["tone"], string> = {
  format: "text-foreground/90",
  config: "text-foreground/65",
};
