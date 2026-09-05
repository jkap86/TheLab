import { FlaskMark } from "./flask-mark";

/**
 * The wordmark, engraved into a recessed plate: flask on a raised bezel, a
 * milled groove, then the type.
 *
 * The engraving is two copies of the same string. The lower one carries the
 * extrusion (a stack of 1px shadows sinking away from the face) and is
 * `aria-hidden`; the upper one is the `<h1>` and is the only copy in the
 * accessibility tree. The face is a gradient clipped to the glyphs, so its
 * colour is `transparent` and a `text-shadow` on it would show *through* the
 * letterforms — the highlight and the glow are `drop-shadow()` filters
 * instead, which follow the alpha rather than the box. They are a token
 * (`--wordmark-depth`) rather than a filter list in the class string, because a
 * stack written to sink the type into a dark plate only smears it on a light
 * one.
 *
 * Both copies are `whitespace-nowrap`, and the type steps down below `sm`. The
 * two are one fix: the plate is wider than a phone at 2.5rem, and a face that
 * wraps under an extrusion that cannot leaves a ghost "LAB" hanging off the
 * plate's right edge.
 */
export function LabWordmark() {
  return (
    <div className="inline-flex items-center gap-4 rounded-xl border border-foreground/8 bg-[image:var(--plate-bg)] py-3 pl-3 pr-[1.625rem] shadow-[var(--plate-shadow)]">
      <span
        aria-hidden
        className="inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)]"
      >
        <FlaskMark size={34} />
      </span>

      {/* The groove: a dark hairline with a light one sitting on its far edge,
          which is what makes it read as milled rather than drawn. */}
      <span
        aria-hidden
        className="my-0.5 w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
      />

      {/* A `div`, not a `span`: the `<h1>` inside it is flow content, which a
          span cannot legally hold. `inline-block` keeps the box identical. */}
      <div className="relative inline-block whitespace-nowrap font-display text-[length:var(--fs-28)] font-bold uppercase leading-none tracking-[0.09em] sm:text-[length:var(--fs-40)]">
        <span
          aria-hidden
          className="absolute left-0 top-0 text-[var(--chrome-extrude)] [text-shadow:var(--chrome-extrude-shadow)]"
        >
          The Lab
        </span>
        <h1 className="relative m-0 inline-block bg-[image:var(--chrome-face)] bg-clip-text font-[inherit] text-transparent [filter:var(--wordmark-depth)]">
          The Lab
        </h1>
      </div>
    </div>
  );
}
