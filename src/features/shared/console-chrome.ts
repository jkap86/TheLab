/*
 * The console's shared surfaces, as class strings.
 *
 * A key is a physically raised object: the resting shadow carries a 3px riser
 * under it and the pressed shadow drops to 1px, so pressing one travels. They
 * have to agree, which is the whole argument for the constant — and it lives in
 * `shared/` rather than in `features/tools` because the leagues console builds
 * on it too, which is the line that decides where a client piece goes.
 *
 * There are two shapes of key and two depths of recess, and the pairs are not
 * interchangeable:
 *
 * - {@link CONSOLE_KEY} is a *pill*, for a key standing on its own in a row of
 *   keys. {@link CONSOLE_KEY_BLOCK} is a *slab*, for a key stacked with others
 *   in a housing where a column of stadiums would read as a list of tablets.
 * - {@link CONSOLE_TRACK} is the tight channel a single key travels in — deep,
 *   so the key reads proud of it. {@link CONSOLE_WELL} is the shallow tray a
 *   whole panel of controls sits in, which at the same depth would read as a
 *   hole rather than a surface.
 */

/** The travel every key shares: raised at rest, down on its own shadow when pressed. */
const KEY_PRESS =
  "transition-[transform,box-shadow,color] duration-150 " +
  "active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";

/**
 * Pill geometry and travel, carrying **no colour of its own**.
 *
 * The split from {@link CONSOLE_KEY} is not tidiness. A key with two states
 * has to be composed as `shape + state`, and appending `border-active/40` to a
 * string that already says `border-foreground/10` is a coin flip: both
 * utilities have the same specificity, so which wins is decided by the order
 * Tailwind happened to emit them in, not by the order they appear in the class
 * attribute. A shape that names no colour cannot lose that flip.
 */
export const CONSOLE_KEY_PILL =
  "shrink-0 rounded-full border px-4 py-2 " +
  `font-mono text-[0.6875rem] uppercase tracking-[0.16em] ${KEY_PRESS}`;

/** The everyday key: the pill above, unlit. */
export const CONSOLE_KEY =
  `${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] ` +
  "text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout";

/**
 * The same, with square-ish corners, for keys stacked in a housing — a column
 * of stadiums reads as a list of tablets. Colourless for the reason above.
 */
export const CONSOLE_KEY_BLOCK =
  "inline-flex items-center rounded-[0.625rem] border px-3 py-2 " +
  `font-mono text-[0.6875rem] uppercase tracking-[0.16em] ${KEY_PRESS}`;

/** The machined housing a key or a readout is mounted in. */
export const CONSOLE_HOUSING =
  "inline-flex items-center rounded-full border border-foreground/8 " +
  "bg-[image:var(--key-bg)] p-1.5 shadow-[var(--plate-shadow)]";

/** The deep channel a single raised key sits in — the nav track, a lens toggle. */
export const CONSOLE_TRACK =
  "rounded-full bg-[image:var(--key-bg)] shadow-[var(--track-shadow)]";

/** The shallow tray a panel of controls sits in — a filter rail, a rule bay. */
export const CONSOLE_WELL =
  "rounded-[0.875rem] border border-foreground/8 bg-[image:var(--key-bg)] " +
  "shadow-[var(--well-shadow)]";

/**
 * Lit glass: the surface a *number* is drawn on, as opposed to a label.
 *
 * `relative` and `overflow-hidden` are part of it because the scanlines are an
 * absolutely-positioned child — CSS has no way to spell a repeating overlay as
 * a second background on an element that already has one here, so every
 * readout in the app carries the same `aria-hidden` span.
 */
export const CONSOLE_READOUT =
  "relative overflow-hidden border border-black/85 bg-[image:var(--readout-bg)] " +
  "shadow-[var(--readout-shadow)]";
