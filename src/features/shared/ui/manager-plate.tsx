import type { ReactNode } from "react";

import { CONSOLE_BILLET_FACE } from "../console-chrome";
import { Avatar } from "../avatar";
import { BilletFinish, MilledHairline } from "./card-plate";

/**
 * The manager's identity, engraved into a recessed plate: avatar on a raised
 * bezel, a milled groove, then the eyebrow and the name — and, where a page
 * gives it one, the season's figures on the same engraving.
 *
 * It lives in `features/shared` rather than beside the manager tool because the
 * lineup checker draws the same plate — the line `CONSOLE_KEY` moved on, and
 * for the same reason: two hand-copied identity plates are two chances for one
 * of them to stop matching the console around it.
 *
 * **Nothing draws this any more.** `/manager` moved to {@link ManagerBillet}
 * below — the same content milled out of the stock its league cards are made
 * of — and the lineup checker followed it one pass later, so a reader walking
 * between the two tools sees one console. The billet was written as a sibling
 * rather than an edit to this box precisely so the checker's header would not
 * move without anybody asking; now that it has, this is the `peekActiveSeason`
 * case — a component with no caller, kept for the argument it carries. The
 * plate is the recessed, chrome-engraved treatment, and every decision below
 * about the bezel, the groove, the two-copy engraving and the `children` seam
 * is what the billet was measured against. Delete it when the argument has
 * been rehoused, not before.
 *
 * The same plate as the tools page's `LabWordmark`, with two differences that
 * follow from the content rather than from taste. The bezel holds the
 * manager's `<Avatar />` instead of the flask, so a real `avatar_url` renders
 * and the letter fallback still works. And the engraved string is a *display
 * name* — arbitrary length, arbitrary case — so it is a size down from the
 * wordmark and allowed to wrap, where "The Lab" never had to.
 *
 * The bezel is `size-12` below `sm` and not `size-10`: at 40px a fixed 44px
 * `Avatar size="lg"` lapped the ring on all four sides. Both halves moved —
 * the avatar steps down to 38px there (see `avatar.tsx`, where it lands for
 * every caller) and the mount up to 48px, which is the 44-in-56 proportion the
 * desktop plate already has.
 *
 * The engraving is two copies of the same string: the lower one carries the
 * extrusion and is `aria-hidden`, the upper one is the `<h1>`. The face is a
 * gradient clipped to the glyphs, so its colour is `transparent` and a
 * `text-shadow` on it would show *through* the letterforms — the depth is
 * `drop-shadow()` filters instead, which follow the alpha. They come from
 * `--wordmark-depth` rather than a filter list in the class string, for the
 * reason `LabWordmark` gives: a stack written to sink type into a dark plate
 * only smears it on a light one.
 *
 * **`children` is the seam the merged header is built on, and it is optional
 * for a reason.** A page drawing this with a season's figures wants a
 * full-width box; the lineup checker draws the plate with no season at all on
 * an account with no leagues, and stands an attention housing to the right of
 * it. So the *presence* of children is what switches the box between the two: a
 * plate carrying a season runs the shell's width, and a plate carrying only a
 * name stays `inline-flex` and lets whatever sits beside it have the rest of
 * the row.
 *
 * **`controls` is the second seam, and it is a strip rather than a fourth
 * column.** The page's own keys came back down off the app rack and onto the
 * plate, because up there a lit key was a second answer to a question the plate
 * already had the figure for — and only one of the two says *what* was
 * narrowed. It renders after `children` as a full-width flex item, so the
 * plate's own `flex-wrap` gives it a line of its own, and it is separated by a
 * milled *cut* read horizontally — a dark hairline with a light one under it —
 * rather than by `--groove`, which is the vertical channel beside the avatar
 * and would read as a rule turned on its side.
 *
 * **`compactStrip` is gone**, and it is worth saying where. It was the phone
 * pass: below `sm` the season and the controls became one strip, so the manager
 * page's Filters key landed beside the figure it narrows rather than a row
 * under it. `/manager` was its only caller and the billet arranges its own two
 * rows, so the seam went with the caller — along with the `display: contents`
 * and the `order-*` interleave it cost `SeasonSummary`. The lineup checker
 * never took it: its week figures and its attention window are a phone row on
 * their own, and merging a key into them would be a redesign of that page
 * rather than a compaction of this plate.
 */
export function ManagerPlate({
  name,
  avatarUrl,
  eyebrow,
  children,
  controls,
}: {
  /** Display name, or the username where Sleeper has no display name. */
  name: string;
  avatarUrl: string | null | undefined;
  /** The page's static copy, rendered on the server — see the page. */
  eyebrow: ReactNode;
  /**
   * The season's figures, mounted on the same engraving — see the module note.
   * A caller that passes these owns their own wrap behaviour: below `sm` they
   * drop onto a line under the name rather than truncating it, which is what
   * `flex-wrap` here is for.
   */
  children?: ReactNode;
  /**
   * The page's own controls, on the plate's bottom strip — see the module note.
   * A caller passing these is also passing `children`: the strip needs the
   * plate's full-width box, which only a plate carrying a season has.
   */
  controls?: ReactNode;
}) {
  return (
    // The padding and the gaps step up at `sm`, which is the whole of the phone
    // pass at this level: a plate that spent 12px of padding and 16px of gutter
    // on a 402px screen was ~270px of an 874px viewport before a single league
    // card. Above `sm` every number is exactly what it was.
    <div
      className={`items-center gap-3 rounded-xl border border-foreground/8 bg-[image:var(--plate-bg)] py-2.5 pl-3 shadow-[var(--plate-shadow)] sm:gap-4 sm:py-3 ${
        children
          ? "flex w-full flex-wrap gap-y-3 pr-3 sm:gap-y-5 sm:pr-[1.125rem]"
          : "inline-flex max-w-full pr-3 sm:pr-6"
      }`}
    >
      <span
        aria-hidden
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)] sm:size-14"
      >
        <Avatar url={avatarUrl} name={name} size="lg" />
      </span>

      {/* The groove: a dark hairline with a light one sitting on its far edge,
          which is what makes it read as milled rather than drawn. */}
      <span
        aria-hidden
        className="my-0.5 w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
      />

      {/* Divs, not spans, for `LabWordmark`'s reason: the `<h1>` below is flow
          content, which a span cannot legally hold. */}
      {/* `flex-1` below `sm` is what lets the name column take the row's slack
          rather than leaving it at the plate's right edge — there is nothing
          beside it there, the season having moved to a strip of its own. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-[0_1_auto] sm:gap-1.5">
        {eyebrow}
        <div className="relative inline-block font-display text-[length:var(--fs-21)] font-bold uppercase leading-none tracking-[0.06em] sm:text-[length:var(--fs-32)] sm:tracking-[0.07em]">
          <span
            aria-hidden
            className="absolute left-0 top-0 text-[var(--chrome-extrude)] [text-shadow:var(--chrome-extrude-shadow)]"
          >
            {name}
          </span>
          <h1 className="relative m-0 inline-block bg-[image:var(--chrome-face)] bg-clip-text font-[inherit] text-transparent [filter:var(--wordmark-depth)]">
            {name}
          </h1>
        </div>
      </div>

      {children}

      {/* `w-full` is what makes this a strip and not a fourth column: the plate
          is `flex w-full flex-wrap` whenever it has children, so a full-width
          item takes its own line under them. The border pair is the plate's
          milled cut read horizontally — see the module note. */}
      {controls && (
        <div className="flex w-full flex-wrap items-center gap-3 border-t border-black/55 pt-3.5 shadow-[0_-1px_0_rgba(255,255,255,0.05)]">
          {controls}
        </div>
      )}
    </div>
  );
}

/**
 * The same identity, milled out of **billet** rather than engraved into a
 * recessed plate — `/manager`'s header.
 *
 * **It is a sibling of {@link ManagerPlate} rather than a variant of it**, and
 * the reason was the checker: that page drew the plate and was not part of the
 * billet's design, so editing the box in place would have moved its header
 * without anybody asking. It draws the billet now too — with a week's figures
 * through `children` and the four reasons through `controls` — and the plate
 * has no caller. What the two share is the content and the two seams; what
 * they do not share is a single surface, a padding, a gap or a type size, which
 * is what makes a `variant` prop a `?:` on every line rather than a switch at
 * the top.
 *
 * **The page's first object had been the one thing on it not made of metal.**
 * Every league card below is a machined housing with milled parts bolted to it,
 * and the plate above them was a recess with type sunk into it — so the header
 * read as a different class of thing from the hundred objects it introduced,
 * and its figures were the only readings on the page neither lit nor stamped
 * into a face. This is the same stock as a card's own settings and standing
 * strips: `--billet-bg` under {@link BilletFinish}'s grain and raking specular,
 * chamfered by `--standing-strip-shadow`.
 *
 * **The chrome engraving is deliberately dropped.** The plate draws the name as
 * two stacked copies — an extrusion under a gradient clipped to the glyphs —
 * which is a treatment for type sunk into a *recess*. On a billet's face the
 * name is `--billet-name` over `--billet-name-shadow`, which is what a league
 * card's own ledge already uses, so the header and the cards name a thing the
 * same way. The `<h1>` stays an `<h1>`.
 *
 * **The win rate is the hero, and it is the only reading here that earns an
 * instrument.** Leagues and the combined record are counts — they compare to
 * nothing and are engraved figures in one milled well. A rate is a proportion,
 * so it keeps the dial, mounted on its own bezel at 108px with the figure in a
 * lit window at its centre. See `SeasonSummary`, which draws all three.
 *
 * **One row at `lg` and two below it, and both arrangements are this one DOM.**
 * The billet is `flex-wrap`, every `order-*` on a child is the compact
 * arrangement and every `lg:order-none` hands the row back to DOM order — which
 * is the wide order, read left to right. So the compact `Filters` key beside
 * the name and the wide one at the row's far end are the *same* key, and there
 * is exactly one `<dialog>` mounted at any width. Rendering it twice and hiding
 * one is the other way to do it, and it is the way the app rack already
 * declined for this reason.
 *
 * **The turn is `lg`, where the design says `sm`, and a render is what refused
 * it.** The wide row's fixed costs are an avatar, a counts well, a 108px gauge
 * and its label, the keys, two cuts and six gutters — about 634px before the
 * name has anything at all. At `sm` the billet's content box is 580px, so the
 * keys wrapped to a second line *and* the name was left 74px: `SLIMJIM` read
 * `SLI…` at both 640 and 768, with the eyebrow broken over two lines under it.
 * That is the failure this repo has recorded at three other grains, and `lg` is
 * the breakpoint `LeagueTeams` and the app rack both moved to after measuring
 * exactly it. Below `lg` the two-row arm carries the name at full width, which
 * it does better at 768 than the columns would.
 *
 * **What does *not* move with it is the type and the avatar**, which step at
 * `sm` as they do everywhere: `--type-scale` turns there and `Avatar size="lg"`
 * steps 38px → 44px there, so the mount has to step with it or the face laps
 * the ring. Those are the app's own scale rather than this part's arrangement,
 * and the two-row arm at 768 has room for the larger name — more of it, in
 * fact, than the one-row arm would.
 *
 * **The avatar mount is `size-12` / `size-14`, where the design draws 44px**,
 * and the difference is `Avatar`'s and not this component's. That size is fixed
 * at 38px below `sm` and 44px above it, so a 44px mount is a 44px face in a
 * 42px ring — the lapping this repo has already recorded once, at the other
 * width. The mock's own drawing is a ~5px ring, and 5px of ring around *this*
 * avatar is 48px and 56px. So the ring is the design's and the diameter is the
 * component's; against a 108px dial the mount still reads as subordinate,
 * which is the proportion the design is actually making.
 */
export function ManagerBillet({
  name,
  avatarUrl,
  eyebrow,
  children,
  controls,
}: {
  /** Display name, or the username where Sleeper has no display name. */
  name: string;
  avatarUrl: string | null | undefined;
  /** The page's static copy, rendered on the server — see the page. */
  eyebrow: ReactNode;
  /**
   * The season's figures. Below `sm` they are the second row and carry the cut
   * above themselves; from `sm` up they are `display: contents` and their parts
   * become items of this row — see `SeasonSummary`, which owns both shapes.
   */
  children?: ReactNode;
  /**
   * The page's own controls: the keys, and the sentence saying what they did.
   * The keys are an item of this row (the phone puts them beside the name, the
   * desktop at its far end) and the sentence is a `w-full` item, so it takes a
   * line of its own under everything at either width.
   */
  controls?: ReactNode;
}) {
  return (
    // `gap-y` is what spaces the phone's two rows and, above `sm`, whatever
    // wraps off the end of the one row — the `filterSummary` sentence always,
    // and the rest only on a window narrow enough to need it.
    <div
      className={`${CONSOLE_BILLET_FACE} relative flex w-full flex-wrap items-center gap-x-2.5 gap-y-2 rounded-[0.875rem] p-2 shadow-[var(--standing-strip-shadow)] lg:gap-x-[1.125rem] lg:gap-y-3 lg:px-3.5 lg:py-3`}
    >
      <BilletFinish />

      {/* Every child from here down is `relative`: the two finish overlays above
          are absolutely positioned, and an absolutely-positioned box paints
          over in-flow content that is not itself positioned. */}
      <span
        aria-hidden
        className="relative order-1 inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)] sm:size-14 lg:order-none"
      >
        <Avatar url={avatarUrl} name={name} size="lg" />
      </span>

      {/* A div, not a span, for `LabWordmark`'s reason: the `<h1>` below is flow
          content, which a span cannot legally hold. */}
      <div className="relative order-2 flex min-w-0 flex-1 flex-col gap-0.5 sm:gap-[0.1875rem] lg:order-none">
        {/* The eyebrow's *treatment* is the part's, where its copy is the
            page's — the page hands over `Manager` as an unstyled node and this
            says what ink a caption stamped on metal is. Written on the row
            rather than on the node, so the season beside it cannot come to be
            inked differently from the word it qualifies.

            `flex-wrap`, so that where the phone row's name column cannot hold
            the whole eyebrow the season drops to a second line *whole*, with
            its middot, rather than the row squeezing a break into the middle
            of a page's own copy. `/manager`'s never wraps; the lineup
            checker's is what found it, and that page shortens its copy below
            `sm` so this is the fallback rather than the arrangement. */}
        <span className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:gap-x-2 sm:text-[length:var(--fs-10)]">
          {eyebrow}
        </span>
        <h1 className="m-0 truncate font-display text-[length:var(--fs-21)] font-semibold uppercase leading-none tracking-[0.05em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] sm:text-[length:var(--fs-24)] sm:tracking-[0.06em]">
          {name}
        </h1>
      </div>

      {children}

      {controls && (
        <>
          {/* The cut between the season and the keys. Below `sm` they are on
              different rows with the season's own horizontal cut between them,
              and a vertical hairline across a wrap is a stub hanging off the
              line above. */}
          <MilledHairline className="relative hidden lg:block" />
          {controls}
        </>
      )}
    </div>
  );
}
