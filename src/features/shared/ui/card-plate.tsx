import type { CSSProperties, ReactNode } from "react";

import { Avatar } from "../avatar";
import {
  CONSOLE_BILLET,
  CONSOLE_CHIP_RAISED,
  CONSOLE_MILLED_WELL,
  CONSOLE_PLATE,
} from "../console-chrome";
import { rampDepth, rampFace } from "../rank-ramp";

/**
 * The plates that straddle a console card's top edge.
 *
 * Every league card in the app now carries the same header: the league on the
 * left, one instrument reading on the right — a trade's timestamp, a manager's
 * record and ranks, a week's projected outcome. The plates are the same object
 * on all three, so they live here rather than being copied into three features,
 * on the line that moved `CONSOLE_KEY` and `ManagerPlate`: a second reader.
 *
 * **One flex row, never two absolutely-positioned spans.** `trade-card.tsx`
 * found this at 390px, where the date is nearly as wide as the card: laid out
 * independently the two plates overlap and the league name runs straight under
 * the date. In a row the right plate keeps its width and the name truncates,
 * which is the right way round — a clipped league name is still readable, a
 * clipped date is not.
 */

/**
 * The row itself, hung off the card's top edge.
 *
 * `-top-[13px]` against the card's `1.875rem` (30px) top padding is what leaves
 * the plate half on the bezel and half above it. The row is `absolute`, so the
 * card's own first child starts at the padding rather than under the plate.
 *
 * **The three league cards no longer mount this** — they take
 * {@link CardBilletRow} and {@link LeagueBillet} since the expanded-card pass.
 * The picktracker board and the comps page still do, on the plate pill: they
 * were not part of that design and a plate is still the right part where the
 * subject is a draft or a player-season rather than a league.
 */
export function CardPlateRow({ children }: { children: ReactNode }) {
  return (
    <div className="absolute -top-[13px] left-5 right-5 flex items-center gap-2.5">
      {children}
    </div>
  );
}

/**
 * The billet's row, hung off the card's top edge — {@link CardPlateRow} for a
 * taller part.
 *
 * `-top-[18px]` against a `2.125rem` (34px) top padding on a desktop, `-top-4`
 * against `1.875rem` (30px) on a phone: the same half-on, half-above the plate
 * row leaves, one size up. **The insets match the card's own horizontal
 * padding at each width** — `18px` from `sm`, `14px` below it — because an
 * absolutely positioned part resolves `left`/`right` against the card's
 * padding box, its border's inner edge, while everything under it starts one
 * padding in. That is the measurement `CardLedge` documents, and it is what
 * puts the billet's left edge on the settings strip's.
 *
 * The lineup checker and the trade card stand a {@link ReadingPlate} in this
 * row beside the billet, as they did beside the plate; on the manager card the
 * billet has the row to itself.
 */
export function CardBilletRow({ children }: { children: ReactNode }) {
  return (
    <div className="absolute -top-4 left-3.5 right-3.5 flex items-center gap-2.5 sm:-top-[18px] sm:left-[18px] sm:right-[18px]">
      {children}
    </div>
  );
}

/**
 * The league, as a **milled billet carrying an engraved name** — the card's
 * subject, cut from the same stock as the settings and standing strips under
 * it, which is what makes the header read as part of the same instrument
 * rather than as a pill pinned to it.
 *
 * It replaces {@link LeaguePlate} on the three league cards. The plate set the
 * name in mono at `--fs-16` with `tracking-[0.08em]` on a `CONSOLE_PLATE` pill;
 * this sets it in the display face at `--fs-24` (`--fs-18` on a phone), 600,
 * uppercase, as **engraved chrome** — the treatment the wordmark and the page
 * titles already wear: `--chrome-face` clipped to the glyphs over a transparent
 * fill, with `--wordmark-depth` for the cast.
 *
 * **The depth is a `filter`, never a `text-shadow`.** The fill is transparent,
 * so a text-shadow paints *above* the element's background and the dark offset
 * copies cover the gradient inside the glyph bodies — the word renders as flat
 * slate with a 1px lit rim. It is the failure `--alert-depth` records one
 * component over, and the reason both are tokens: a `drop-shadow` list written
 * into the class string could not invert for the light scheme, where
 * `--chrome-face` is a dark ramp and the billet goes near-white.
 *
 * **The name has the line to itself**, which is the whole point of the part:
 * the standing moved off the plate row in an earlier pass, so on the manager
 * card nothing competes with it for width, and the `truncate` it still
 * declares is for a hundred-character league. On the two cards that keep a
 * reading plate beside it the name truncates into what is left, as it did
 * beside the plate.
 *
 * Two alternatives were built and rejected in the design file: a lit
 * nameplate — the name in `--readout-text` inside a glass window — which makes
 * the name a *reading the league reports about itself* rather than the card's
 * subject, and would be a third place the card spends teal; and the same
 * billet with the name stamped in `--billet-name` ink, which reads as one more
 * label on one more strip, since it is the same ink as `Teams` and `Starters`
 * below it. What landed is the second's part carrying the first's hierarchy.
 *
 * Everything inside is `relative` to sit above the grain and the specular —
 * `BilletFinish`'s two overlays are absolutely positioned children.
 *
 * **The name's `drop-shadow` stack rides `pointer-fine:`**, on the league
 * card's own per-device budget: a `filter` is a compositor buffer per element,
 * and this billet is one per card on every card of all three tools — the
 * per-card filter buffer the old engraved title was already gated for, since a
 * hundred of them at DPR 3 is what killed the tab on iOS Safari. A coarse
 * pointer gets the same chrome ramp clipped to the glyphs, without the cast.
 */
export function LeagueBillet({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null | undefined;
}) {
  return (
    <span className="relative inline-flex min-w-0 items-center gap-[9px] overflow-hidden rounded-xl bg-[image:var(--billet-bg)] pb-[7px] pl-1.5 pr-[15px] pt-1.5 shadow-[var(--standing-strip-shadow)] sm:gap-3 sm:rounded-[13px] sm:pb-2 sm:pl-[7px] sm:pr-5 sm:pt-[7px]">
      <BilletFinish />
      <LeagueMark name={name} url={avatarUrl} size="lg" />
      <span className="relative min-w-0 truncate bg-[image:var(--billet-face)] bg-clip-text font-display text-[length:var(--fs-18)] font-semibold uppercase leading-[1.1] tracking-[0.03em] text-transparent sm:text-[length:var(--fs-24)] sm:leading-[1.05] pointer-fine:[filter:var(--wordmark-depth)]">
        {name}
      </span>
    </span>
  );
}

/**
 * The card's standing as a **milled strip** bolted to the housing's face,
 * beside the settings it is a result of.
 *
 * **It exists because of a width, and the width is the card's own subject.**
 * `LeaguePlate` and `ReadingPlate` shared the plate row, and on a 362px card
 * that left the league name ~95px — truncated to "Dynasty Wa…" *after*
 * `standingFields` had already dropped its third field to buy that much. Every
 * fix inside that row is the same trade at a different price. So the row
 * carries the league plate alone, at full width, and the standing comes down
 * here: all three fields are back, the name stops truncating, and nothing is
 * competing for a line.
 *
 * **That was the phone's arrangement and it is now every width's**, which is
 * the pass this component's shape comes from. The desktop card had the same
 * problem in a milder form — a plate opposite the name is a plate the name is
 * paying for, whatever the width — and the two arrangements were also the one
 * thing about this card a reader could see change when they resized it. One
 * treatment, and the plate row is the league's alone at every width.
 *
 * **It shares its row with the settings strip from `sm` up, and takes a line of
 * its own below it** — one arrangement spelled once here rather than a prop the
 * caller switches, since there is exactly one row this part is ever on and
 * which of the two it is, is a width rather than a caller's choice. Sharing, it
 * hugs its content: three bays stretched across a desktop card read as an
 * instrument with nothing in it, which is the design file's `1b` measured
 * against its `1c`. On its own line there is nothing to hug and the three
 * stretch to fill it.
 *
 * **It sits *under* the league's settings strip, not above it**, which is the
 * order the card reads in: what game this is, then how the manager is doing at
 * it, then the four ranks that grade it — the standing next to the figures it
 * belongs with rather than separated from them by the settings. The two parts
 * are the same stock, so the pair reads as one machined block.
 *
 * **Metal, not glass, and that is the decision rather than the finish.** Drawn
 * on `--readout-bg` the strip read as one more thing the league reports about
 * itself, sitting next to the settings window that reports the rest — where a
 * standing is the *reader's* result, not the league's own configuration. A
 * plate bolted to the housing is a different class of object from a window cut
 * into it, and the class is what carries the distinction.
 *
 * Its shadow is one atomic list ({@link CONSOLE_BILLET} on why a shadow list
 * cannot be composed) and lives in `--standing-strip-shadow` for the reason
 * every bevel in `globals.css` does — it is chamfered bright-top and
 * dark-underside, which inverts wholesale on a pale ground rather than dimming.
 *
 * Rejected alternatives, in the design file: a step milled off the plate's own
 * bottom edge, and the standing stamped into the housing face with no part at
 * all. Also superseded is the two-line {@link CardLedge} that carried both —
 * it works, and costs 76px of card before the rule.
 */
export function StandingStrip({
  children,
  stretch = false,
}: {
  children: ReactNode;
  /**
   * The strip has the line to itself at **every** width, so it fills it and its
   * bays stretch with it — the lineup checker's arrangement, where the settings
   * strip takes its own line above rather than sharing this one.
   *
   * A prop rather than a second component, and rather than the parent reaching
   * in with `[&>span]:flex-1`: that is one more selector for a later
   * `flex-none` on the bay to lose an emit-order flip against, which is the
   * trap the console constants are split to avoid. It goes away the day the
   * manager card takes the own-line arrangement too, at which point the `sm:`
   * arms below are dead.
   */
  stretch?: boolean;
}) {
  return (
    <div
      // `items-center`, not `items-stretch`: the *strip* stretches to its
      // neighbour's height so the pair reads as one block, and the bays inside
      // it keep theirs. Stretched too, a wrapped settings strip beside it would
      // make three 80px wells holding a 16px figure each — a part that grew to
      // fill a hole rather than one machined to a size.
      className={`relative flex w-full shrink-0 items-center justify-between gap-[5px] overflow-hidden rounded-[0.625rem] bg-[image:var(--billet-bg)] px-1.5 py-[5px] shadow-[var(--standing-strip-shadow)] ${
        stretch ? "" : "sm:w-auto sm:justify-start"
      }`}
    >
      <BilletFinish />
      {children}
    </div>
  );
}

/**
 * One bay of the strip: a stamped label beside its figure, in a milled well.
 *
 * **The bay *is* the well, and the label sits in it on the figure's own
 * baseline.** It was a label stamped on the face with the figure in a well cut
 * under it, which is where most of the strip's height went — a stacked pair is
 * two lines of type plus the gap between them, and the strip is three of them
 * across a card that has four rank windows still to draw. Side by side the part
 * is one line tall and the reading is unchanged: a label and the number it
 * names, which is what every field on this card already is.
 *
 * **The figure is coloured by what it says**, which is the strip's second job
 * and the reason it is not simply the plate moved down the card. A place is its
 * own percentile in the field and a record is its win share, both on the ramp
 * the rank windows below already run — so the standing agrees with the four
 * figures under it instead of being the one reading on the card drawn in a
 * single ink. The caller computes the percentile, because only it knows which
 * of the two rules this field takes.
 *
 * **It stretches on the strip's own line and hugs its content on the shared
 * one**, at the same `sm` the strip turns on — see {@link StandingStrip} for
 * why that is one arrangement rather than a prop. It is spelled here rather
 * than on the strip because the bay is the box that grows, and a parent
 * reaching in with `[&>span]:flex-1` would be one more selector for a later
 * `flex-none` on the child to lose to on Tailwind's emit order.
 *
 * The engraving is `--standing-engrave` plus the caller's own glow: the static
 * layers are a token because they invert for light mode, and the glow is a
 * continuous ramp colour with no utility to generate. A `text-shadow` is a
 * comma list, so the two compose.
 */
export function StandingBay({
  label,
  tone,
  glow,
  stretch = false,
  children,
}: {
  label: string;
  /**
   * The ramp colour for this field's own percentile, engraved.
   *
   * **Optional, and its absence hands the figure's ink to the caller** — which
   * is what a bay carrying something other than an engraved number needs. The
   * lineup checker's strip is two of those: a polished figure ({@link Polish})
   * and a row of {@link GameChip}s, both of which clip a gradient to their own
   * glyphs over a transparent fill, and a `text-shadow` set here would paint
   * *above* that background and flatten them — the failure `--alert-depth` and
   * `--wordmark-depth` both record. So the engraving is drawn only where there
   * is a flat figure to engrave.
   */
  tone?: string;
  /** The same colour at low alpha, for the figure's halo. Absent with `tone`. */
  glow?: string;
  /** Fill the strip's line rather than hugging content — see {@link StandingStrip}. */
  stretch?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`relative flex min-w-0 flex-1 items-baseline justify-center gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-2 pb-1 pt-[3px] shadow-[var(--standing-well-shadow)] ${
        stretch ? "" : "sm:flex-none"
      }`}
    >
      <span className="whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]">
        {label}
      </span>
      <span
        className="whitespace-nowrap font-display text-[length:var(--fs-16)] font-semibold leading-[1.1] tracking-[-0.015em] tabular-nums"
        style={
          tone === undefined
            ? undefined
            : {
                color: tone,
                textShadow: `var(--standing-engrave), 0 0 18px ${glow}`,
              }
        }
      >
        {children}
      </span>
    </span>
  );
}

/**
 * A figure or a letter set as **tinted chrome**: the ramp's own hue clipped to
 * the glyphs, with the cast behind it.
 *
 * One finish, two parts — a {@link StandingBay}'s figure and a
 * {@link GameChip}'s letter — because a bay reading `+19.3` beside a chip
 * reading `W` is one reading of one game, and a second spelling of the polish
 * is how the two would come to be lit differently.
 *
 * Three things in it are load-bearing and every one of them is silent when it
 * is wrong:
 *
 * 1. **The cast is a `filter`, never a `text-shadow`.** With
 *    `background-clip: text` over a transparent fill the element's background
 *    paints first, so a `text-shadow` paints *above* it and the dark offset
 *    copies cover the gradient inside the glyph bodies — the figure renders as
 *    flat ink with a 1px lit rim. See {@link rampDepth}.
 * 2. **`color: transparent` is spelled as well as `-webkit-text-fill-color`.**
 *    Tailwind's `text-transparent` is the `color` a browser with no
 *    `background-clip: text` falls back to painting, so a glyph is never
 *    invisible on one that ignores the clip.
 * 3. **The cast rides `pointer-fine:`**, on the league card's per-device
 *    budget: a `filter` is a compositor buffer per element and this is up to
 *    three per card on a page with no virtualizer. A variant cannot be spelled
 *    in a `style`, so the computed value travels through a custom property
 *    that the gated utility reads.
 */
const POLISH =
  "bg-clip-text text-transparent [-webkit-text-fill-color:transparent] " +
  "pointer-fine:[filter:var(--polish-depth)]";

/** The two computed halves of the finish, as a style a `pointer-fine:` class reads. */
function polish(percentile: number | null): CSSProperties {
  const style: CSSProperties & { "--polish-depth": string } = {
    backgroundImage: rampFace(percentile),
    "--polish-depth": rampDepth(percentile),
  };
  return style;
}

/**
 * A polished figure on a {@link StandingBay}'s own baseline.
 *
 * The type is the bay's, because it *is* the bay's figure — the bay simply
 * cannot draw it, since the ink is a background rather than a colour.
 */
export function RampFigure({
  percentile,
  children,
}: {
  /** 0–100, or null for the neutral — {@link rankColor}'s own argument. */
  percentile: number | null;
  children: ReactNode;
}) {
  return (
    <span className={`${POLISH} whitespace-nowrap`} style={polish(percentile)}>
      {children}
    </span>
  );
}

/**
 * One game of a week, as a raised chip carrying its result.
 *
 * **A chip per game rather than a record.** `2–0` says how the week added up
 * and cannot say *which* of the two went which way; two chips can, because the
 * strip's own left-to-right order — the head-to-head's bay, then the median's —
 * is what says which is which. A split week is therefore a red `L` beside a
 * green `W` rather than a neutral `1–1`.
 *
 * **Each chip takes its own end of the ramp**, so a good result is the same
 * green here as on every rank window in the app and both ends invert for light
 * mode together.
 *
 * The surface and the letter are two elements and have to be: the chip's face
 * is a `background-image` and so is the polished glyph's, and one element has
 * one background. `CONSOLE_CHIP_RAISED` is the chip's own chamfer plus a cast
 * onto the well it stands in — one atomic list, since a shadow list cannot be
 * appended to.
 *
 * **The letter is `aria-hidden` and the sentence beside it is the reading.** A
 * bare `W W` announced as "W W" is not one.
 */
export function GameChip({
  percentile,
  name,
  children,
}: {
  percentile: number;
  /** The screen reader's sentence: which game, and how it went. */
  name: string;
  children: string;
}) {
  return (
    <span
      className={`${CONSOLE_CHIP_RAISED} relative inline-flex min-w-[1.125rem] justify-center rounded-[0.3125rem] px-1 pb-0.5 pt-px`}
    >
      <span className="sr-only">{name}</span>
      <span
        aria-hidden
        className={`${POLISH} font-display text-[length:var(--fs-16)] font-semibold leading-[1.15] tracking-[0.02em]`}
        style={polish(percentile)}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * The league, as a plate: a lit mark and the league's name.
 *
 * **This is the card's subject.** On the manager and lineup checker cards it
 * replaces a 1.75rem engraved headline, which is the single biggest change in
 * the console-card redesign — a plate is what makes those cards read as the
 * same object as a trade card.
 *
 * `size` is the two sizes the design uses and nothing more: `lg` where the
 * league is the whole subject of the card (manager, lineup checker) and `md` on
 * a trade card, where the subject is the trade and the league is where it
 * happened.
 */
export function LeaguePlate({
  name,
  avatarUrl,
  size = "lg",
}: {
  name: string;
  avatarUrl: string | null | undefined;
  size?: "md" | "lg";
}) {
  return (
    <span
      className={`${CONSOLE_PLATE} inline-flex min-w-0 items-center gap-2.5 py-1.5 pl-[5px] pr-4`}
    >
      <LeagueMark name={name} url={avatarUrl} />
      <span
        className={`min-w-0 truncate font-mono uppercase text-foreground/95 ${
          size === "lg"
            ? "text-[length:var(--fs-16)] tracking-[0.08em]"
            : "text-[length:var(--fs-14)] tracking-[0.1em]"
        }`}
      >
        {name}
      </span>
    </span>
  );
}

/**
 * The league's avatar in a lit ring — the one piece of the plate that glows.
 *
 * The ring is the wrapper's, not the image's: `Avatar` draws a face and the
 * bezel around it belongs to whatever mounts it, which is how the same
 * component sits in `ManagerPlate`'s much larger bezel. A league with no
 * avatar on file falls back to its initial drawn *on the glass* — readout
 * text with the readout's own glow — rather than to `Avatar`'s grey letter,
 * because an unlit letter inside a lit ring reads as a failed image.
 */
function LeagueMark({
  name,
  url,
  size = "sm",
}: {
  name: string;
  url: string | null | undefined;
  /** `sm` is the plate's 24px ring; `lg` is the billet's, 28px from `sm` up. */
  size?: "sm" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={`relative flex shrink-0 items-center justify-center rounded-full border border-active/35 bg-[image:var(--readout-bg)] shadow-[inset_0_0_14px_var(--accent-glow),0_0_14px_-4px_var(--accent-glow)] ${
        size === "lg" ? "size-6 sm:size-7" : "size-6"
      }`}
    >
      {url ? (
        <Avatar url={url} name={name} size="sm" />
      ) : (
        <span
          className={`font-mono text-readout [text-shadow:var(--readout-text-glow)] ${
            size === "lg"
              ? "text-[length:var(--fs-11)] sm:text-[length:var(--fs-12)]"
              : "text-[length:var(--fs-11)]"
          }`}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/**
 * The right-hand plate: one or more readings, on the same chrome as the league.
 *
 * **`tight` is the lineup checker's plate and nothing else's**, which is why it
 * carries a whole box rather than one override. It holds stacked bays and a
 * round pip where every other reader holds a row of baseline-aligned fields,
 * so it wants a shorter padding, a wider gap and — the load-bearing one —
 * `items-stretch`, so the divider between two bays runs their full height
 * instead of being centred at a fixed 13px against a 34px stack.
 *
 * The two boxes are written as two whole strings rather than as a base plus a
 * `tight` amendment, on `CONSOLE_KEY_PILL`'s rule: two base `p*`/`items-*`
 * utilities of the same specificity are decided by Tailwind's emit order, not
 * by the class attribute, so an override written that way is a coin flip.
 *
 * **Both boxes are tighter below `sm`, and that is the league name's width
 * rather than this plate's taste.** It sits opposite a name that truncates, so
 * every pixel the plate spends is a character the card's own subject loses —
 * and the page's type scale grew the figures here by ~12px at a phone's width
 * without growing the card. Taking it back out of the padding and the gap keeps
 * what the plate *says* intact, where dropping a field would not. Above `sm`
 * the card has width to spare and every number is what it was.
 */
export function ReadingPlate({
  children,
  tight = false,
}: {
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <span
      className={`${CONSOLE_PLATE} ml-auto inline-flex shrink-0 whitespace-nowrap ${
        tight
          ? "items-stretch gap-2 py-[5px] pl-3 pr-1.5 sm:gap-[11px] sm:pl-[0.875rem] sm:pr-[9px]"
          : "items-center gap-2 py-1.5 pl-3 pr-3 sm:gap-2.5 sm:pl-4 sm:pr-4"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The date, as a **milled billet**: the day stamped on its face, the minute
 * dropped into a well cut in the same part.
 *
 * **It is where the league's name gets its width back.** The date used to be a
 * {@link ReadingPlate} — one pill, one line, one ink — and it was the widest
 * object in the billet row after the league's own name, which is what pays for
 * it: `Dynasty Warehouse` got 129px of the 234 it wants at 390, and 228px of a
 * 1120px desktop card went to a date. **A plate carrying two readings on a line
 * pays for the second in width; a billet pays for it in height**, and height is
 * the one thing nothing on this row is competing for. That is
 * {@link PlateBay}'s own argument, taken one part further out.
 *
 * It is a *billet* rather than a taller plate because {@link LeagueBillet} is
 * beside it: the two are then parts cut from one piece of stock, where a plate
 * opposite a billet reads as two objects that happen to share a row.
 *
 * **The minute is the reading, which is why it is the one in the well.** The
 * day is the coarse half — a reader of a newest-first board already knows
 * roughly where they are — and the minute is what says where in today's run of
 * trades this trade sits. See `TradeDate`, whose own note is where that came
 * from.
 *
 * A new export rather than a `well` arm on {@link ReadingPlate}: that component
 * has a second caller on the lineup checker's card, and whether *its* reading
 * wants a well is a separate question with its own measurement.
 *
 * `items-end` so the day sits over the well's right edge rather than centred
 * above it — the part is hung off the row's own right end, and a ragged left is
 * what says the two lines are one reading rather than a stack of two.
 */
export function DateBillet({
  day,
  minute,
}: {
  day: ReactNode;
  /** Null where there is no minute to state — no well is drawn at all. */
  minute?: ReactNode;
}) {
  return (
    <span className="relative ml-auto inline-flex shrink-0 flex-col items-end gap-0.5 overflow-hidden rounded-[0.625rem] bg-[image:var(--billet-bg)] px-[7px] pb-1.5 pt-[5px] shadow-[var(--standing-strip-shadow)] sm:gap-[3px] sm:rounded-xl sm:px-[9px] sm:pb-[7px] sm:pt-1.5">
      <BilletFinish />
      <span className="relative whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:text-[length:var(--fs-10)]">
        {day}
      </span>
      {minute != null && (
        <span className="relative whitespace-nowrap rounded-[5px] bg-[image:var(--billet-well-bg)] px-1.5 py-px font-mono text-[length:var(--fs-11)] tabular-nums text-[color:var(--billet-figure)] shadow-[var(--standing-well-shadow)] [text-shadow:var(--standing-engrave)] sm:px-[7px] sm:text-[length:var(--fs-12-5)]">
          {minute}
        </span>
      )}
    </span>
  );
}

/**
 * Who holds the picked player in this league — a small billet hung on the
 * card's top-right edge, naming the leaguemate.
 *
 * The manager page's shares drawer answers *which* of a reader's leagues a
 * player is in; narrowed to the leagues where somebody **else** holds him,
 * nothing on the cards behind the drawer said *who*. This is that answer, and
 * it is deliberately a header part rather than a row in the card body: it sits
 * in {@link CardBilletRow}'s overhang, so it costs the card **zero height** and
 * reads at a glance down a column of a hundred of them.
 *
 * It is {@link DateBillet}'s construction — `ml-auto` at the row's right end,
 * cut from the same stock as the {@link LeagueBillet} opposite — for that
 * part's reason: two billets in a row are parts of one piece, where a pill
 * beside a billet reads as two objects that happen to share a line.
 *
 * **The name yields width, never the league's.** The row is one flex line at
 * every width and `LeagueBillet` is `min-w-0 truncate`, so this part being
 * `shrink-0` means a phone spends ~78px of the league's name on it — the same
 * trade the reading plate already makes on the two other cards. If a longer
 * form is ever wanted, truncate **this** name: a clipped leaguemate is still a
 * person, where a clipped league is the card losing its subject.
 *
 * **There is exactly one state.** It is drawn only where a leaguemate holds
 * him, which is the state the reader has filtered to — a league not in it
 * renders no part at all. An earlier pass had a `You` and a `Free` variant and
 * both were cut: this readout exists for the taken narrowing, and a card that
 * answers a question the reader did not ask is a card with more on it.
 *
 * **Not interactive**, like the standing strip: it is a reading. The card's own
 * press covers the whole summary and this must not swallow it or add a control
 * of its own.
 *
 * @see leagueOwners in `features/manager/helpers/leaguemate-rosters.ts` — the
 * one spelling of *who holds him*, which the drawer's `Taken` count and this
 * part are two readings of.
 */
export function OwnerBillet({
  name,
  avatarUrl,
}: {
  /**
   * The owner, already abbreviated — `shortName`'s `K. Mercer`.
   *
   * Falls back to the stored id where the `league_users` row carries no
   * display name, on `PlayerShare`'s rule: a token beats a blank.
   */
  name: string;
  avatarUrl: string | null | undefined;
}) {
  return (
    <span className="relative ml-auto inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-[9px] bg-[image:var(--billet-bg)] pb-[5px] pl-[5px] pr-1.5 pt-1 shadow-[var(--standing-strip-shadow)]">
      <BilletFinish />
      {/* The face, seated in a hole milled in the billet — the same well the
          date's minute drops into, one size down and round.

          **The avatar is a `background-image` over the initial, never an
          `<img>`.** A background that 404s paints nothing and the letter under
          it is exactly the fallback it is there to be, where a broken `<img>`
          paints the platform's own placeholder glyph over it — `PlayerFace`'s
          reasoning in `lineup-breakdown.tsx` and `SharesDrawerRow`'s `faceUrl`
          arm. The drawer draws a *leaguemate's* avatar through its `<img>` arm
          instead, on the argument that an uploaded picture is there when the
          row says it is; here the fallback is a letter *underneath* rather than
          instead of, which is the construction only the background arm
          composes — and a stored avatar can still 404 for a user who has
          dropped theirs since the sync.

          `bg-center`, where a Sleeper *headshot* takes `bg-top`: an avatar is a
          square somebody uploaded, not a head-and-shoulders crop. */}
      <span
        aria-hidden
        className="relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[image:var(--billet-well-bg)] bg-cover bg-center bg-no-repeat font-mono text-[length:var(--fs-9)] text-[color:var(--billet-figure)] shadow-[var(--standing-well-shadow)] [text-shadow:var(--standing-engrave)]"
        style={
          avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined
        }
      >
        {name.charAt(0).toUpperCase()}
      </span>
      {/* Stamped proud on the face, in the display type the ledge's own name
          takes — the labels around it stay mono, which is this card's
          distinction between a caption cut into metal and the thing it names.

          The engrave is a token rather than the prototype's flat black drop:
          `--billet-figure` inverts to a near-black ink in light mode, and a
          black cast under a black letter is a smear. `--standing-engrave`
          turns over with it. */}
      <span className="relative whitespace-nowrap font-display text-[length:var(--fs-13)] font-semibold leading-[1.15] tracking-[-0.01em] text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)]">
        {name}
      </span>
    </span>
  );
}

/**
 * One bay of a reading plate: a stamped label **over** its figure — **and
 * nothing draws one any more**, along with {@link ReadingPlate}'s `tight` arm,
 * which existed for it.
 *
 * The lineup checker's projected outcome was the only stacked plate, and it is
 * a {@link StandingStrip} on its own line now: the plate was width the league's
 * name opposite it was paying for, which is the trade the whole part existed to
 * make and the one the strip stops making. Kept on `peekActiveSeason`'s terms —
 * the measurement below is the argument for stacking a reading at all, and is
 * what a second plate carrying two figures would need.
 *
 * {@link PlateField} is the same two things side by side, and the difference is
 * width against height. A plate carrying one reading has the room to set it on
 * a line; a plate carrying two does not — measured on the lineup checker's own
 * card at 620px, the pair side by side is 377px against 281px stacked, and the
 * 96px is exactly what the league name opposite was losing (`DYNASTY
 * WAREHOUSE` clipped to `DYNAS…`). So a second reading buys its place by
 * spending the plate's height, which nothing else on the card is competing
 * for.
 *
 * It is **not** {@link LedgeBay}, which is the same idea milled into the
 * manager card's billet: that one is stamped into a machined part and this one
 * is on a plate, so they take different type and different ink. Two components
 * because they are two parts, not two spellings of one.
 *
 * `children` is the figure's whole line rather than a string, because the line
 * is not always a figure: the lineup checker hangs its win/loss pip on the same
 * baseline, which is what keeps a bay one reading rather than a number with
 * something after it.
 */
export function PlateBay({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 flex-col items-start justify-center gap-px">
      <span className="font-mono text-[length:var(--fs-8)] uppercase leading-[1.1] tracking-[0.18em] text-foreground/[0.58] sm:text-[length:var(--fs-9)]">
        {label}
      </span>
      <span className="inline-flex items-center gap-1.5 font-mono text-[length:var(--fs-13)] font-medium leading-[1.05] tabular-nums text-foreground/[0.97] sm:text-[length:var(--fs-16)]">
        {children}
      </span>
    </span>
  );
}

/**
 * One field of a reading plate: a small etched label and its figure.
 *
 * The label is drawn at the plate's own weight rather than the readout's — it
 * is stamped into the metal, not lit — which is what keeps the figure beside it
 * the only thing on the plate a reader's eye lands on.
 *
 * **The figure steps up with the rank tiles losing their denominator**, and the
 * two changes are one: a card that no longer spends nine characters on `2nd of
 * 12` in every tile can afford its plate to carry the reading a reader came for
 * at a size they can take in without stopping. The label grows with it, because
 * a 8px label under a 17px figure reads as a caption that fell off something
 * else rather than as the figure's own name.
 *
 * **It steps up at `sm` and not below, which a render at 390 forced rather than
 * the handoff asking for it.** A plate sits opposite the league's own name in
 * one flex row, and at phone width the two are competing for ~322px: measured,
 * the step-up takes a two-field plate from 155px to 182px and leaves the league
 * name 71px — six characters, where `StandingPlate` already drops its third
 * field precisely to keep that number at nine. So the size is the question the
 * width answers, not the card: below `sm` every reading plate keeps the type it
 * had, and at 640 the same name has 236px and the design's own figure. It is
 * the rule the trade card's date already lives by, one row up.
 *
 * The step lands on every reading plate in the app — the lineup checker's
 * projected score and the picktracker's next pick as well as the league card's
 * standing — which is the point of the shared component, and each was checked
 * at 390 and 1280. `PlateDivider` grows on the same breakpoint: a divider cut
 * shorter than the type either side of it reads as a gap rather than a cut.
 */
export function PlateField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline gap-[5px] sm:gap-[0.375rem]">
      <span className="font-mono text-[length:var(--fs-8)] uppercase tracking-[0.18em] text-foreground/[0.58] sm:text-[length:var(--fs-10)]">
        {label}
      </span>
      <span className="font-mono text-[length:var(--fs-13)] font-medium tabular-nums text-foreground/[0.97] sm:text-[length:var(--fs-17)]">
        {children}
      </span>
    </span>
  );
}

/**
 * The milled divider between two fields of one plate.
 *
 * `--groove` and its highlight rather than a hand-written pair, because it is
 * the same cut the console makes everywhere else and it already inverts for
 * light mode.
 *
 * **`stretch` runs it the bay's own height instead of a fixed one**, which is
 * what a plate of stacked bays needs: a 17px cut centred in a 34px stack reads
 * as a dash somebody left in the gap rather than as the channel between two
 * parts. It is a prop rather than a second component because it is the same
 * cut — the height is the only thing the two readings disagree about, and a
 * second divider is how the two would come to disagree about the rest.
 */
export function PlateDivider({ stretch = false }: { stretch?: boolean } = {}) {
  return (
    <span
      aria-hidden
      className={`w-px bg-[image:var(--groove)] shadow-[var(--groove-highlight)] ${
        stretch ? "my-0.5 self-stretch" : "h-[13px] sm:h-[17px]"
      }`}
    />
  );
}

/**
 * The hairline under a card's plate row.
 *
 * It grows on hover, which is the affordance the glass cards had and the one
 * thing about them worth keeping: the handoff draws it static at its full
 * 92px and says the growth may stay.
 *
 * Every reader is a `<details class="group/card">`, which is what the open and
 * hover states here are written against. The trade card was the exception that
 * "drew no rule" — it had no disclosure to open — and it has one now: it opens
 * onto the league the trade happened in.
 *
 * **`shrink-0` is for the one reader that stands something beside it.** The
 * trade card's open header puts the league's format tags on this row, so the
 * rule is a flex item on a main axis with something else on it — and a 1px
 * hairline left shrinkable is the first thing to give under pressure, which it
 * would do without a trace. On the two league cards it is the only child of a
 * column flex and the declaration is a no-op.
 */
export function CardRule() {
  return (
    <span
      aria-hidden
      className="relative block h-px w-9 shrink-0 bg-gradient-to-r from-active/50 to-transparent transition-[width] duration-[450ms] group-hover/card:w-[5.75rem] group-hover/card:from-active/90 group-data-[lit]/card:w-[5.75rem] group-data-[lit]/card:from-active/90 pointer-fine:[transform:translateZ(36px)]"
    />
  );
}

/**
 * The scanline overlay every lit window carries.
 *
 * A child rather than a second background, for the reason `CONSOLE_READOUT`
 * gives: CSS cannot spell a repeating overlay as a second background on an
 * element that already has a gradient one.
 */
export function Scanlines() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
    />
  );
}

/**
 * The **billet ledge**: one milled part straddling a card's top edge, carrying
 * the card's subject on its face and its standing in a well cut below.
 *
 * This is the manager league card's header, and it replaces {@link CardPlateRow}
 * there rather than in general — the trade, lineup-checker and picktracker cards
 * still take the two-plate row, which the design bundle behind this does not
 * cover. Both live here for the same reason either one does: a card header is a
 * shared object, and the day a second card takes the ledge it takes this one.
 *
 * **What the ledge fixes is a line, not a surface.** Two plates in one row are
 * two things competing for the same width: the reading plate keeps its own and
 * the league name — the card's whole subject — truncates into whatever is left,
 * which at a phone's width was nine characters and had already cost the points
 * rank its place on the plate opposite to get there. Stacked into one part the
 * name has the full line and stops truncating at all, and the standing sits
 * under it in a well, so **depth carries the hierarchy where a second pill used
 * to**.
 *
 * A billet rather than a plate because a plate cannot hold two lines: see
 * {@link CONSOLE_BILLET}. The grain and the raking specular are what make it
 * read as milled stock rather than as a gradient, and they are children rather
 * than a second background for `Scanlines`' reason — CSS cannot spell a second
 * background on an element that already has one.
 *
 * **The insets match the card's own horizontal padding at each width**, and
 * that is alignment rather than taste: the ledge is absolutely positioned, so
 * `left`/`right` resolve against the card's *padding box* — its border's inner
 * edge — while everything under it starts one padding in. Written as `0` the
 * ledge would overhang the chip rail below by exactly the card's gutter, and
 * the standing bays inside it are meant to share the rail's left margin.
 */
export function CardLedge({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${CONSOLE_BILLET} absolute -top-[18px] left-3.5 right-3.5 rounded-[0.8125rem] px-2 py-[0.4375rem] sm:-top-5 sm:left-4 sm:right-4 sm:p-2`}
    >
      <BilletFinish />
      {children}
    </div>
  );
}

/**
 * The two overlays that make a billet read as machined: a horizontal brushed
 * grain and one raking specular across it.
 *
 * Exported because a chip is the same stock — see the chip rail — and two
 * spellings of a finish is a rail whose parts are visibly cut from different
 * metal. The grain is horizontal where the card's own is diagonal, which is
 * what says the ledge is a separate part bolted on rather than a region of the
 * housing behind it.
 */
export function BilletFinish() {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--billet-grain)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--billet-specular)]"
      />
    </>
  );
}

/**
 * The ledge's first line: the league's mark, then its name, proud on the face.
 *
 * **The name has the line to itself**, which is the whole point of the ledge —
 * it is `flex-1 min-w-0` against a fixed mark, so the only thing that can take
 * width from it is the mark, and the truncation it still declares is a
 * hundred-character league rather than an ordinary one.
 *
 * It is `--font-display` where the rest of a card is mono, which the console
 * card pass deliberately made uniform and this deliberately breaks: the labels
 * around it stay mono, so the two families are the card's own distinction
 * between a caption stamped into metal and the thing it names.
 */
export function LedgeName({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null | undefined;
}) {
  return (
    <span className="relative flex min-w-0 items-center gap-2.5 px-1 pb-1.5 pt-px sm:gap-[0.6875rem]">
      <LeagueMark name={name} url={avatarUrl} />
      <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-14)] font-medium uppercase tracking-[0.1em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] sm:text-[length:var(--fs-17)] sm:tracking-[0.12em]">
        {name}
      </span>
    </span>
  );
}

/**
 * The ledge's second line: a shallow well cut into the same part.
 *
 * Its gradient is the face's inverted, which is the entire cue that it is a
 * recess rather than a second face — see {@link CONSOLE_MILLED_WELL}. The bays
 * inside it are **left-aligned**, sharing the name's own left margin and the
 * chip rail's below: right-aligned they open a dead gap through the middle of
 * the ledge, which is the variant the design rejected.
 */
export function LedgeWell({ children }: { children: ReactNode }) {
  return (
    <span
      className={`${CONSOLE_MILLED_WELL} relative flex items-stretch gap-3 rounded-lg px-2 py-1.5 sm:gap-[0.9375rem] sm:px-[0.6875rem] sm:py-[0.375rem]`}
    >
      {children}
    </span>
  );
}

/**
 * One bay of a milled part: a stamped label over its figure.
 *
 * The same object in the ledge's well and in a chip on the rail below, which is
 * why it lives here rather than in either — two spellings of a bay is a card
 * whose standing and whose settings are set in different type.
 *
 * `children` rather than a `value` string because a bay's figure is not always
 * text: the format bay leads with a lit lamp and a slot bay with its ladder,
 * and both sit on the figure's own baseline.
 */
export function LedgeBay({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-col justify-center gap-px sm:gap-[3px]">
      <span className="whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.11em] text-[color:var(--billet-label)] sm:text-[length:var(--fs-10)] sm:tracking-[0.13em]">
        {label}
      </span>
      <span className="inline-flex items-center gap-[0.375rem] sm:gap-[0.4375rem]">
        {children}
      </span>
    </span>
  );
}

/** A bay's figure, on the one type every figure milled into this card shares. */
export function LedgeFigure({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap font-display text-[length:var(--fs-15)] font-medium leading-[1.15] tracking-[-0.005em] tabular-nums text-[color:var(--billet-figure)] sm:text-[length:var(--fs-16)]">
      {children}
    </span>
  );
}

/**
 * The cut between two bays of **one** part.
 *
 * Shallower than {@link PlateDivider}, which uses `--groove` — a groove is the
 * channel between two parts of a console, and there is only one part here. It
 * is a dark line with the light catching its far lip, and `self-stretch` is
 * what makes it a cut rather than a dash: it runs the bay's own height, inset a
 * few pixels top and bottom so it never touches the part's chamfer.
 *
 * `className` is a width gate and nothing else: the identity billet is one row
 * at `sm` and two below it, and a vertical cut between two things that are no
 * longer side by side is a stub hanging off the wrap. Which cuts exist is the
 * caller's arrangement, so the caller says so — the cut itself is one spelling.
 */
export function MilledHairline({ className = "" }: { className?: string } = {}) {
  return (
    <span
      aria-hidden
      className={`my-[0.1875rem] w-px shrink-0 self-stretch bg-[color:var(--milled-hairline)] shadow-[var(--milled-hairline-highlight)] ${className}`}
    />
  );
}
