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
 */
export const TOOL_CARD_SURFACE =
  "relative flex flex-1 flex-col rounded-[1.125rem] border border-foreground/12 " +
  "bg-[image:var(--card-bg)] px-[1.375rem] pb-[1.625rem] pt-7 " +
  "shadow-[var(--card-bevel),var(--card-lift)]";

export const TOOL_CARD_HOVER =
  "group lab-card-3d [transform-style:preserve-3d] [transform-origin:center_bottom] " +
  "[transform:translateZ(0)_rotateX(3deg)] " +
  "hover:[transform:translateZ(30px)_rotateX(0deg)] " +
  "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
  "hover:z-10 hover:border-active/45 " +
  "hover:shadow-[var(--card-bevel),var(--card-lift-hover),var(--card-halo-hover)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";

export function ToolCardContent({
  text,
  description,
}: {
  text: string;
  description: string;
}) {
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
        <span className="lab-anim absolute inset-y-0 left-0 w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover:translate-x-[450%]" />
        {/* The graticule, laid flat under the card like a scope floor. Masked
            out toward the top so it recedes instead of ending on a line. */}
        <span className="absolute -inset-x-1/4 -bottom-[8%] h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover:opacity-100" />
        {/* The glow the fluid throws on the floor. */}
        <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover:opacity-80" />
        {/* The edge light: the top rim of the card coming on. */}
        <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover:opacity-100" />
      </span>

      {/* The tool name, engraved the same way as the wordmark but a size down.
          The gradient is clipped to the glyphs, so the depth is a drop-shadow
          filter rather than a text-shadow — and a token, because the dark
          scheme sinks the type with black where the light one lifts it with
          white. The hover glow is the second token rather than an appended
          filter, since `filter` does not compose across two declarations. */}
      <span className="relative mt-1 bg-[image:var(--chrome-face)] bg-clip-text font-display text-[1.75rem] font-semibold leading-[1.06] tracking-[-0.04em] text-transparent text-balance [filter:var(--card-title-depth)] [transform:translateZ(44px)] transition-[filter] duration-[450ms] group-hover:[filter:var(--card-title-depth-hover)]">
        {text}
      </span>

      {/* The accent rule: a short cyan hairline that extends on hover. */}
      <span
        aria-hidden
        className="relative mt-3.5 block h-px w-9 bg-gradient-to-r from-active/50 to-transparent transition-[width] duration-[450ms] [transform:translateZ(36px)] group-hover:w-[5.75rem] group-hover:from-active"
      />

      <p className="relative mt-[0.9375rem] text-[0.8125rem] leading-normal text-foreground/60 transition-colors duration-[450ms] text-pretty [transform:translateZ(14px)] group-hover:text-foreground/[0.78]">
        {description}
      </p>

      {/* Pinned to the card floor with `mt-auto`, so the row of equal-height
          cards reads as intentional rather than as short cards with a hole in
          them. */}
      <span
        aria-hidden
        className="relative mt-auto flex items-center gap-2 pt-6 text-xs tracking-[0.03em] text-foreground/60 transition-colors duration-[450ms] [transform:translateZ(22px)] group-hover:text-active"
      >
        <span className="h-px w-4 bg-current transition-[width] duration-[450ms] group-hover:w-11" />
        Open
      </span>
    </>
  );
}
