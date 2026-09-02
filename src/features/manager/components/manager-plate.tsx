import type { ReactNode } from "react";

import { Avatar } from "@/features/shared";

/**
 * The manager's identity, engraved into a recessed plate: avatar on a raised
 * bezel, a milled groove, then the eyebrow and the name.
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
 */
export function ManagerPlate({
  name,
  avatarUrl,
  eyebrow,
}: {
  /** Display name, or the username where Sleeper has no display name. */
  name: string;
  avatarUrl: string | null | undefined;
  /** The page's static copy, rendered on the server — see the page. */
  eyebrow: ReactNode;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-4 rounded-xl border border-foreground/8 bg-[image:var(--plate-bg)] py-3 pl-3 pr-6 shadow-[var(--plate-shadow)]">
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
    </div>
  );
}
