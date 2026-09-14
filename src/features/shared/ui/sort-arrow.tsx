/**
 * The direction of the order in force on a column head, drawn rather than
 * typed.
 *
 * **`▲` and `▼` are not in IBM Plex Mono**, so the browser draws them from
 * whichever font the platform falls back to — measured on macOS Chrome, a
 * glyph 12.4px wide at `--fs-8`. That is most of the slack a fixed-width head
 * has: it squeezed the start/sit console's lit `Start ▼` to `ST…` and the
 * manager console's lit `Value ▼` to `VAL…`. A drawn triangle is 7px on every
 * platform, so the arithmetic a head's width is measured against holds wherever
 * it is read.
 *
 * `currentColor`, so it takes the lit head's accent with the label beside it;
 * `aria-hidden`, because the head's own label already says the direction in
 * words.
 */
export function SortArrow({ ascending }: { ascending: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 7 5"
      width="7"
      height="5"
      fill="currentColor"
      className="shrink-0"
    >
      <path d={ascending ? "M3.5 0 7 5H0Z" : "M0 0h7L3.5 5Z"} />
    </svg>
  );
}
