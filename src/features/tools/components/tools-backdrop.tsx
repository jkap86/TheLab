/**
 * The tools page's ambient aurora — three slow-drifting, blurred colour fields
 * fixed behind the whole page. It sits at `-z-10` over the app's flat
 * background, so the glows show through the glass cards and the page gutters and
 * give the empty space some depth.
 *
 * Not a client component: it is pure markup with CSS animation, so it renders on
 * the server and stays out of the bundle (the same reasoning as `FlaskLoader`).
 * The drift keyframes live in `globals.css`; each blob carries its own position,
 * size, and duration here as data, since a keyframe can't. The colours are
 * literal `rgba` gradient stops — cyan is the `active` token's value, indigo and
 * magenta have no token — the deliberate exception the flask's liquid also makes.
 * `.tools-anim` lets `prefers-reduced-motion` freeze them.
 */
export function ToolsBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <span
        className="tools-anim absolute h-[520px] w-[520px] blur-3xl"
        style={{
          left: "-6%",
          top: "-14%",
          background:
            "radial-gradient(circle, rgba(0, 255, 229, 0.22), transparent 62%)",
          animation: "aurora-drift-1 24s ease-in-out infinite",
        }}
      />
      <span
        className="tools-anim absolute h-[560px] w-[560px] blur-3xl"
        style={{
          right: "-10%",
          top: "-8%",
          background:
            "radial-gradient(circle, rgba(124, 139, 255, 0.26), transparent 62%)",
          animation: "aurora-drift-2 30s ease-in-out infinite",
        }}
      />
      <span
        className="tools-anim absolute h-[460px] w-[460px] blur-3xl"
        style={{
          right: "8%",
          bottom: "-16%",
          background:
            "radial-gradient(circle, rgba(255, 92, 196, 0.16), transparent 64%)",
          animation: "aurora-drift-3 34s ease-in-out infinite",
        }}
      />
    </div>
  );
}
