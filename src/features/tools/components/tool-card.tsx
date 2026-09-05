/*
 * The card is a bevelled panel that rises toward the viewer.
 *
 * The rise is real perspective, not a `translateY`: the `<li>` owns the
 * `perspective`, the card sits at `rotateX(3deg)` at rest and flattens to
 * `translateZ(30px)` on hover, and the contents carry their own small
 * `translateZ` so the type separates from the glass as it comes forward.
 *
 * Two things that look optional are not. `transform-style: preserve-3d` is
 * what keeps the contents' `translateZ` meaningful — without it they flatten
 * into the card's plane — and it cannot coexist with `overflow: hidden`, which
 * forces flattening. So the decorative layers (sheen, floor, glow) live inside
 * one absolutely-positioned wrapper that does the clipping, and the content
 * layers stay siblings in the 3D context.
 *
 * The card must also be a flex child of the `<li>` (`flex-1`, not
 * `h-full`): a percentage height cannot resolve against an auto-sized grid
 * row, so `h-full` sizes the row short and the card overflows its own cell.
 *
 * **Every part of that depth rides `pointer-fine:`**, which is the league
 * cards' gate rather than a breakpoint, and for their reason: the tilt exists
 * to be flattened by a hover, so on a touch device it is a composited plane
 * per card bought with nothing to spend it on. A coarse pointer gets the same
 * card flat — bevel, gradients, resting lift — and the sheen, floor and glow
 * layers, which are only ever visible mid-hover or exist to be foreshortened
 * by a tilt that is not there, are not rendered for it at all.
 */
export const TOOL_CARD_SURFACE =
  "relative flex flex-1 flex-col rounded-[1.125rem] border border-foreground/12 " +
  "bg-[image:var(--card-bg)] px-[1.125rem] pb-5 pt-[1.125rem] " +
  "sm:px-[1.375rem] sm:pb-[1.625rem] sm:pt-7 " +
  "shadow-[var(--card-bevel),var(--card-lift)]";

export const TOOL_CARD_HOVER =
  "group lab-card-3d pointer-fine:[transform-style:preserve-3d] [transform-origin:center_bottom] " +
  "pointer-fine:[transform:translateZ(0)_rotateX(3deg)] " +
  "pointer-fine:hover:[transform:translateZ(30px)_rotateX(0deg)] " +
  "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
  "hover:z-10 hover:border-active/45 " +
  "pointer-fine:hover:shadow-[var(--card-bevel),var(--card-lift-hover),var(--card-halo-hover)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";

/**
 * A locked card's foot, and the phone card's status word, are the same fact
 * said at two lengths: `Account needed` where there is a row to say it in, and
 * `Account` where it shares the title's line.
 *
 * It is words rather than dimming. The card used to be drawn at `opacity-45`,
 * which took a description already at `text-foreground/60` to a composite near
 * 1.9:1 — on a first visit, three of the five cards. The dimming was also the
 * only *visible* signal that the card was inert (the `role="link"` +
 * `aria-disabled` pair carried it for everybody else), so this is a
 * replacement rather than a removal.
 */
const FOOT = {
  open: { long: "Open", short: "Ready" },
  locked: { long: "Account needed", short: "Account" },
} as const;

export function ToolCardContent({
  text,
  description,
  locked = false,
}: {
  text: string;
  description: string;
  locked?: boolean;
}) {
  const foot = locked ? FOOT.locked : FOOT.open;
  const footTone = locked ? "text-foreground/55" : "text-active/85";

  return (
    <>
      {/* Everything decorative, in the one layer that clips. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      >
        {/* Specular: the light the bevel is catching. */}
        <span className="absolute inset-x-0 top-0 h-[45%] bg-[image:var(--card-specular)]" />
        {/* A band of light that sweeps across the glass on hover. */}
        <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover:translate-x-[450%] pointer-fine:block" />
        {/* The graticule, laid flat under the card like a scope floor. Masked
            out toward the top so it recedes instead of ending on a line. */}
        <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover:opacity-100 pointer-fine:block" />
        {/* The glow the fluid throws on the floor. */}
        <span className="absolute -bottom-[45%] left-1/2 hidden h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover:opacity-80 pointer-fine:block" />
        {/* The edge light: the top rim of the card coming on. */}
        <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover:opacity-100" />
      </span>

      {/* The title row. Below `sm` the status word rides it, right-aligned,
          because the foot row it normally sits in is dropped there — the whole
          card is the target on a touch device, so a row whose only job is to
          say "this is pressable" is a row spent on nothing. */}
      <span className="relative mt-1 flex items-baseline gap-3 pointer-fine:[transform:translateZ(44px)]">
        {/* The tool name, engraved the same way as the wordmark but a size
            down. The gradient is clipped to the glyphs, so the depth is a
            drop-shadow filter rather than a text-shadow — and a token, because
            the dark scheme sinks the type with black where the light one lifts
            it with white. The hover glow is the second token rather than an
            appended filter, since `filter` does not compose across two
            declarations. */}
        <span className="min-w-0 flex-1 bg-[image:var(--chrome-face)] bg-clip-text font-display text-[length:var(--fs-24)] font-semibold leading-[1.06] tracking-[-0.03em] text-transparent text-balance transition-[filter] duration-[450ms] sm:text-[length:var(--fs-28)] sm:tracking-[-0.04em] pointer-fine:[filter:var(--card-title-depth)] pointer-fine:group-hover:[filter:var(--card-title-depth-hover)]">
          {text}
        </span>
        <span
          aria-hidden
          className={`shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] ${footTone} sm:hidden`}
        >
          {foot.short}
        </span>
      </span>

      {/* The accent rule: a short cyan hairline that extends on hover. */}
      <span
        aria-hidden
        className="relative mt-2.5 block h-px w-8 bg-gradient-to-r from-active/50 to-transparent transition-[width] duration-[450ms] sm:mt-3.5 sm:w-9 pointer-fine:[transform:translateZ(36px)] group-hover:w-[5.75rem] group-hover:from-active"
      />

      <p className="relative mt-2.5 text-[length:var(--fs-13)] leading-normal text-foreground/60 transition-colors duration-[450ms] text-pretty sm:mt-[0.9375rem] pointer-fine:[transform:translateZ(14px)] group-hover:text-foreground/[0.78]">
        {description}
      </p>

      {/* Pinned to the card floor with `mt-auto`, so the row of equal-height
          cards reads as intentional rather than as short cards with a hole in
          them. Below `sm` it is gone entirely; the word it carries has moved
          onto the title row above. */}
      <span
        aria-hidden
        className={`relative mt-auto hidden items-center gap-2 pt-6 text-[length:var(--fs-12)] tracking-[0.03em] ${footTone} transition-colors duration-[450ms] sm:flex pointer-fine:[transform:translateZ(22px)] ${
          locked ? "" : "group-hover:text-active"
        }`}
      >
        <span
          className={`h-px w-4 bg-current transition-[width] duration-[450ms] ${
            locked ? "" : "group-hover:w-11"
          }`}
        />
        {foot.long}
      </span>
    </>
  );
}
