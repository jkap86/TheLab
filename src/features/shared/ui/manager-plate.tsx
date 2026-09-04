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
 */
export function ManagerPlate({
  name,
  avatarUrl,
  eyebrow,
  children,
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
}) {
  return (
    <div
      className={`items-center gap-4 rounded-xl border border-foreground/8 bg-[image:var(--plate-bg)] py-3 pl-3 shadow-[var(--plate-shadow)] ${
        children
          ? "flex w-full flex-wrap gap-y-5 pr-[1.125rem]"
          : "inline-flex max-w-full pr-6"
      }`}
    >
      <span
        aria-hidden
        className="inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)]"
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
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow}
        <div className="relative inline-block font-display text-[1.5rem] font-bold uppercase leading-none tracking-[0.07em] sm:text-[2rem]">
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
    </div>
  );
}
