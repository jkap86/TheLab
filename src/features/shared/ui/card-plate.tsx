import type { ReactNode } from "react";

import { Avatar } from "../avatar";
import {
  CONSOLE_BILLET,
  CONSOLE_MILLED_WELL,
  CONSOLE_PLATE,
} from "../console-chrome";

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
 */
export function CardPlateRow({ children }: { children: ReactNode }) {
  return (
    <div className="absolute -top-[13px] left-5 right-5 flex items-center gap-2.5">
      {children}
    </div>
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
function LeagueMark({ name, url }: { name: string; url: string | null | undefined }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-active/35 bg-[image:var(--readout-bg)] shadow-[inset_0_0_14px_var(--accent-glow),0_0_14px_-4px_var(--accent-glow)]"
    >
      {url ? (
        <Avatar url={url} name={name} size="sm" />
      ) : (
        <span className="font-mono text-[length:var(--fs-11)] text-readout [text-shadow:var(--readout-text-glow)]">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/**
 * The right-hand plate: one or more readings, on the same chrome as the league.
 *
 * `tight` exists for the lineup checker's win/loss pip, which is round and
 * needs less plate to the right of it than a run of text does.
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
      // **The plate is tighter below `sm`, and that is the league name's
      // width rather than this plate's taste.** It sits opposite a name that
      // truncates, so every pixel the plate spends is a character the card's
      // own subject loses — and the page's type scale grew the figures here by
      // ~12px at a phone's width without growing the card. Taking it back out
      // of the padding and the gap keeps what the plate *says* intact, where
      // dropping a field would not. Above `sm` the card has width to spare and
      // every number is what it was.
      className={`${CONSOLE_PLATE} ml-auto inline-flex shrink-0 items-center gap-2 whitespace-nowrap py-1.5 pl-3 sm:gap-2.5 sm:pl-4 ${
        tight ? "pr-[5px] sm:pr-[7px]" : "pr-3 sm:pr-4"
      }`}
    >
      {children}
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
 */
export function PlateDivider() {
  return (
    <span
      aria-hidden
      className="h-[13px] w-px bg-[image:var(--groove)] shadow-[var(--groove-highlight)] sm:h-[17px]"
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
 * Both readers are a `<details class="group/card">`, which is what the open and
 * hover states here are written against — the trade card has no disclosure and
 * draws no rule.
 */
export function CardRule() {
  return (
    <span
      aria-hidden
      className="relative block h-px w-9 bg-gradient-to-r from-active/50 to-transparent transition-[width] duration-[450ms] group-hover/card:w-[5.75rem] group-hover/card:from-active/90 group-open/card:w-[5.75rem] group-open/card:from-active/90 pointer-fine:[transform:translateZ(36px)]"
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
 */
export function MilledHairline() {
  return (
    <span
      aria-hidden
      className="my-[0.1875rem] w-px shrink-0 self-stretch bg-[color:var(--milled-hairline)] shadow-[var(--milled-hairline-highlight)]"
    />
  );
}
