/**
 * The two glyphs this page's Browse keys carry in the rack.
 *
 * **They live here rather than in `features/tools` because the page owns
 * them**, which is the rule `RackDrawerKey.icon` states and the same one that
 * made the legends data: the rack is mounted above `{children}` and cannot
 * `switch` on the route, so a drawing held up there would be every page's
 * vocabulary in one folder. A second page publishes a different pair — see the
 * lineup checker's own file of this name.
 *
 * They are hand-drawn geometry rather than an icon set, so a shared icon module
 * would be a folder holding four unrelated pictures whose only common property
 * is their size.
 *
 * **Both are drawn for a lit cap, not for the rack's ground.** They sit at 17px
 * inside a 32px accent face, reading dark-on-light in the dark scheme and
 * light-on-teal in the light one — which is what the stroke weights are set
 * against. `SlidersMark` in `rack-controls-keys.tsx` made the same adjustment
 * and its note carries the measurement: at a machined key's 16px and 1.7 the
 * strokes close up against a face rather than against a housing.
 *
 * `currentColor` throughout, so the cap's `--cap-accent-ink` is what draws them
 * and the light scheme inverts with the cap rather than beside it.
 */

/** A head and shoulders: one player, which is what a share is a count of. */
export function PlayersMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[1.0625rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c0-3.6 2.9-6.1 6.5-6.1s6.5 2.5 6.5 6.1" />
    </svg>
  );
}

/**
 * Two of them, the second smaller and set back — the same figure at a distance
 * rather than a second figure beside it, which is what keeps the pair readable
 * at 17px where two equal heads read as one wide shape.
 */
export function LeaguematesMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[1.0625rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="8.4" cy="8.6" r="2.9" />
      <circle cx="16.6" cy="10.4" r="2.4" />
      <path d="M3 19.4c0-3.1 2.4-5.3 5.4-5.3s5.4 2.2 5.4 5.3" />
      <path d="M15.6 15.2c2.8 0 5.4 1.6 5.4 4.2" />
    </svg>
  );
}
