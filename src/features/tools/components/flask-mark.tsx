/**
 * The flask mark. Two filled paths and a rule: the vessel, the fluid in the
 * bottom third, and the ground-glass lip. Sized by `size` rather than by a
 * class so it can sit in a 34px bezel here and a 42px one elsewhere without a
 * second copy.
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
      <path
        d="M10.2 3v5.4L4.9 19.1a1.1 1.1 0 0 0 1 1.6h12.2a1.1 1.1 0 0 0 1-1.6L13.8 8.4V3"
        className="fill-active/10 stroke-active"
        strokeWidth={1.4}
      />
      {/* The fluid. Flat top, following the vessel's taper to the base. */}
      <path
        d="M7.3 14.8h9.4l2.8 5.4a1 1 0 0 1-1 .5H5.5a1 1 0 0 1-1-.5z"
        className="fill-active/45"
      />
      <path d="M9.2 3h5.6" className="stroke-active" strokeWidth={1.4} />
    </svg>
  );
}
