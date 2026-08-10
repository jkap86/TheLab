import type { CSSProperties } from "react";

/**
 * The app's ambient aurora — three slow-drifting, blurred colour fields fixed
 * behind every page. It sits at `-z-10` over the flat background, so the glows
 * show through the glass cards and the page gutters and give the empty space
 * some depth.
 *
 * It began as the tools page's own backdrop and is rendered from the root layout
 * now, which is the point of the move: the tools page reading as a different app
 * from the tool it opens was mostly this. A page that wants a plainer ground has
 * none to opt out of — the glows are ambient rather than content, and nothing on
 * a page is laid out against them.
 *
 * Not a client component: it is pure markup with CSS animation, so it renders on
 * the server and stays out of the bundle (the same reasoning as `FlaskLoader`).
 * The drift keyframes live in `globals.css`; each blob carries its own position,
 * size, tint and duration here as data, since a keyframe can't. The colours are
 * literal `rgba` — cyan is the `active` token's value, indigo and magenta have no
 * token — the deliberate exception the flask's liquid also makes.
 * `.lab-anim` lets `prefers-reduced-motion` freeze them.
 *
 * **The tint is a custom property rather than a whole `background`, and that is
 * what pays for the phone.** Three 500-odd-pixel boxes under `filter:
 * blur(64px)` are three promoted compositor layers whose backing store is
 * expanded by the blur radius on every side — on a device pixel ratio of 3 that
 * is tens of megabytes of texture behind a decoration, on top of every
 * `backdrop-filter` surface the page itself wears, which is the budget mobile
 * WebKit discards a page over. So below `sm` there is **no filter at all**: the
 * gradient's own falloff runs to the full radius instead (`.lab-aurora` in
 * `globals.css`), which is the same soft glow drawn by the ramp rather than by a
 * filter pass, and the drift holds still there the way it already does for a
 * reader who asked for less motion. Desktop keeps the blur, the tighter stop and
 * the drift exactly as they were — the class carries only the *shape*, so the
 * colours stay here.
 */

/** One blob: everything a keyframe can't carry. */
type Aurora = {
  className: string;
  /** The gradient's centre colour, read by `.lab-aurora` as `--aurora-tint`. */
  tint: string;
  animation: string;
  position: CSSProperties;
};

const AURORAS: Aurora[] = [
  {
    className: "h-[520px] w-[520px] sm:blur-3xl",
    tint: "rgba(0, 255, 229, 0.22)",
    animation: "aurora-drift-1 24s ease-in-out infinite",
    position: { left: "-6%", top: "-14%" },
  },
  {
    className: "h-[560px] w-[560px] sm:blur-3xl",
    tint: "rgba(124, 139, 255, 0.26)",
    animation: "aurora-drift-2 30s ease-in-out infinite",
    position: { right: "-10%", top: "-8%" },
  },
  {
    className: "h-[460px] w-[460px] sm:blur-3xl",
    tint: "rgba(255, 92, 196, 0.16)",
    animation: "aurora-drift-3 34s ease-in-out infinite",
    position: { right: "8%", bottom: "-16%" },
  },
];

export function AmbientBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {AURORAS.map((aurora) => (
        <span
          key={aurora.animation}
          className={`lab-aurora lab-anim absolute ${aurora.className}`}
          style={
            {
              ...aurora.position,
              "--aurora-tint": aurora.tint,
              animation: aurora.animation,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
