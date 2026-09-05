import type { ReactNode } from "react";

import { Avatar } from "../avatar";

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
 * for a reason.** On `/manager` the plate absorbed what used to be a separate
 * summary housing beside it, so the name and the season's two figures are one
 * object; the lineup checker draws the same plate with no season at all, and
 * that page stands an attention housing to the right of it. So the *presence*
 * of children is what switches the box between the two: a plate carrying a
 * season runs the shell's width, and a plate carrying only a name stays
 * `inline-flex` and lets whatever sits beside it have the rest of the row.
 * Editing the box in place would have moved the checker's header without
 * anyone asking.
 *
 * **`controls` is the second seam, and it is a strip rather than a fourth
 * column.** The manager page's Filters key came back down off the app rack and
 * onto this plate, because up there it was a second answer to a question the
 * plate already had the figure for — the rack's key and the plate's
 * `Leagues 9 / 14` were the same news in two places, and only one of them says
 * what was narrowed. It renders after `children` as a full-width flex item, so
 * the plate's own `flex-wrap` gives it a line of its own, and it is separated
 * by a milled *cut* read horizontally — a dark hairline with a light one under
 * it — rather than by `--groove`, which is the vertical channel beside the
 * avatar and would read as a rule turned on its side.
 *
 * **`compactStrip` is the phone pass, and it is the third seam.** On a 402px
 * screen the plate was ~270px tall — a third of the viewport spent before a
 * single league card — because it stacked a name row, a season row and a
 * controls row, each at desktop padding. Below `sm` the padding and the gaps
 * step down, the avatar and the engraved name step down with them, and the
 * season and the controls become **one** strip: `Leagues · Filters │ Record │
 * dial`. That is ~135px, and the key ends up beside the figure it narrows
 * rather than a row below it.
 *
 * It is opt-in because the merge is not something the plate can do to a caller
 * that has not been written for it — see the prop, and see `SeasonSummary` for
 * the `display: contents` and the `order` it costs the caller's own blocks. The
 * lineup checker deliberately does not take it: its week figures and its
 * attention window are a phone row on their own, and merging a key into them
 * would be a redesign of a page rather than a compaction of this one.
 */
export function ManagerPlate({
  name,
  avatarUrl,
  eyebrow,
  children,
  controls,
  compactStrip = false,
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
  /**
   * Below `sm`, put the figures and the controls on **one** strip rather than
   * two — see the module note. Opt-in rather than the default because it is a
   * claim about the caller's own two blocks: they have to be written for it
   * (`display: contents` and an `order` each), and a caller that has not been
   * gets two strips, which is what every plate did before this existed.
   */
  compactStrip?: boolean;
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

      {/*
        The two lower blocks, and `compactStrip` is which shape they take.

        Two strips (the default): the season is a full-width item, the controls
        are a second one under it, and the controls carry the milled cut. That
        is what the plate has always drawn and what the lineup checker still
        wants — its week figures and its attention window fill a phone's row on
        their own.

        One strip (`compactStrip`, below `sm`): a wrapper takes the cut and both
        blocks go `display: contents` inside it, so the figures and the keys are
        items of the *same* flex row and an `order` each can interleave them —
        which is how `/manager` gets `Leagues · Filters │ Record │ dial` on one
        line. Rendering the key twice and hiding one would be the other way to
        do it, and it would mount two `<dialog>`s: the rack settled that
        argument the same way, with `display: contents` rather than a copy.

        `sm:contents` is what makes the wrapper vanish above the breakpoint, so
        at every width from `sm` up the two blocks are plate items again and
        nothing about the desktop plate moved.
      */}
      {compactStrip ? (
        <div className="flex w-full flex-wrap items-stretch gap-x-1.5 gap-y-2 border-t border-black/55 pt-2.5 shadow-[0_-1px_0_rgba(255,255,255,0.05)] sm:contents">
          {children}
          {controls && (
            <div className="contents sm:flex sm:w-full sm:flex-wrap sm:items-center sm:gap-3 sm:border-t sm:border-black/55 sm:pt-3.5 sm:shadow-[0_-1px_0_rgba(255,255,255,0.05)]">
              {controls}
            </div>
          )}
        </div>
      ) : (
        <>
          {children}

          {/* `w-full` is what makes this a strip and not a fourth column: the
              plate is `flex w-full flex-wrap` whenever it has children, so a
              full-width item takes its own line under them. The border pair is
              the plate's milled cut read horizontally — see the module note. */}
          {controls && (
            <div className="flex w-full flex-wrap items-center gap-3 border-t border-black/55 pt-3.5 shadow-[0_-1px_0_rgba(255,255,255,0.05)]">
              {controls}
            </div>
          )}
        </>
      )}
    </div>
  );
}
