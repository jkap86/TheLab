import { FLASK_FLUID, FLASK_LIP, FLASK_VESSEL } from "@/features/shared";

/**
 * The flask mark. Two filled paths and a rule: the vessel, the fluid in the
 * bottom third, and the ground-glass lip. Sized by `size` rather than by a
 * class so it can sit in a 34px bezel here and a 42px one elsewhere without a
 * second copy.
 *
 * **The three paths come from `features/shared`**, which is where the loading
 * indicator that animates them lives — see `BubblingFlask`. They are declared
 * there rather than here because that is the direction the layering allows:
 * `features/tools` may read `features/shared` and the reverse would invert it.
 * One spelling either way, which is the point — the loading flask cuts a clip
 * path from the vessel, and a mark that had drifted from it would be a rim
 * around a shape it no longer holds.
 */
export function FlaskMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={FLASK_VESSEL} className="fill-active/10 stroke-active" strokeWidth={1.4} />
      {/* The fluid. Flat top, following the vessel's taper to the base. */}
      <path d={FLASK_FLUID} className="fill-active/45" />
      <path d={FLASK_LIP} className="stroke-active" strokeWidth={1.4} />
    </svg>
  );
}
