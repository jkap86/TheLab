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
  `font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] ${KEY_PRESS}`;

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
  `font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] ${KEY_PRESS}`;

/** The machined housing a key or a readout is mounted in. */
export const CONSOLE_HOUSING =
  "inline-flex items-center rounded-full border border-foreground/8 " +
  "bg-[image:var(--key-bg)] p-1.5 shadow-[var(--plate-shadow)]";

/** The deep channel a single raised key sits in — the nav track, a lens toggle. */
export const CONSOLE_TRACK =
  "rounded-full bg-[image:var(--key-bg)] shadow-[var(--track-shadow)]";

/**
 * The same channel, from `sm` up only.
 *
 * A recess exists to hold a key that stands proud of it, so a key drawn
 * *etched* on a phone (see {@link PLATE_KEY}) has nothing to be recessed from
 * and the track goes with it. Derived from {@link CONSOLE_TRACK} by hand rather
 * than by a prefixing helper, because Tailwind scans class strings statically
 * and a computed prefix produces no CSS at all — the two have to be kept in
 * step, which is why they sit together.
 */
export const CONSOLE_TRACK_SM =
  "sm:rounded-full sm:bg-[image:var(--key-bg)] sm:shadow-[var(--track-shadow)]";

/**
 * A key **etched into a plate** rather than raised on one, below `sm`, and an
 * ordinary {@link CONSOLE_KEY_PILL} from `sm` up.
 *
 * The manager plate's phone strip is what asks for it: `Leagues · Filters │
 * Record` is one engraved reading with a control in the middle of it, and a key
 * standing 3px proud among engraved figures reads as an object dropped onto the
 * plate rather than as part of it. So on a phone it is a hairline and a
 * hint of inset light — cut in, not sat on — and the geometry steps down with
 * the figures beside it.
 *
 * Geometry and chrome are two constants for {@link CONSOLE_KEY_PILL}'s reason:
 * a key with states composes as `shape + state`, and a shape that names a
 * colour makes which one wins a matter of Tailwind's emit order. The travel and
 * the focus ring are the same at both widths — an etched key still presses.
 */
export const PLATE_KEY =
  "inline-flex shrink-0 items-center rounded-full border px-2 py-[0.3125rem] " +
  "font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] " +
  `sm:px-4 sm:py-2 sm:text-[length:var(--fs-11)] ${KEY_PRESS}`;

/** {@link PLATE_KEY}'s surface: cut into the plate below `sm`, raised above it. */
export const PLATE_KEY_CHROME =
  "bg-foreground/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] " +
  "sm:bg-[image:var(--key-bg)] sm:shadow-[var(--key-shadow)]";

/** The shallow tray a panel of controls sits in — a filter rail, a rule bay. */
export const CONSOLE_WELL =
  "rounded-[0.875rem] border border-foreground/8 bg-[image:var(--key-bg)] " +
  "shadow-[var(--well-shadow)]";

/**
 * A card as an *instrument housing*: a bezel with lit windows set into it.
 *
 * The console cards used to be glass — `--card-bg` with readout tiles floating
 * on it — and this inverts that relationship: the card body is the housing and
 * everything carrying a reading is a window cut into it. Shared because all
 * three league cards (trades, manager, lineup checker) are the same object seen
 * three times, and a housing that drifted between them would read as three
 * different instruments.
 *
 * The 18px radius and the `30px 18px 18px` padding are part of it: the top
 * padding is what the plate straddling the edge needs to clear.
 */
export const CONSOLE_CARD =
  "relative rounded-[1.125rem] border border-foreground/10 " +
  "bg-[image:var(--housing-bg)] px-[1.125rem] pb-[1.125rem] pt-[1.875rem] " +
  "shadow-[var(--housing-shadow)]";

/**
 * A readout set *into* a housing, as opposed to sitting on a panel.
 *
 * {@link CONSOLE_READOUT} with the lit bottom lip that closes the recess
 * against the bezel around it — see `--window-shadow`. Same `relative
 * overflow-hidden` contract: the scanlines are an absolutely-positioned child,
 * so every window carries one.
 */
export const CONSOLE_WINDOW =
  "relative overflow-hidden border border-black/85 bg-[image:var(--readout-bg)] " +
  "shadow-[var(--window-shadow)]";

/**
 * The plate that straddles a housing's top edge — the league name, the record,
 * the week's projection.
 *
 * Colourless in the same sense {@link CONSOLE_KEY_PILL} is not: a plate has one
 * state, so its border travels with it. What it does *not* carry is layout —
 * the row it sits in, and whether it is the left plate or the right one, belong
 * to the card.
 */
export const CONSOLE_PLATE =
  "rounded-full border border-foreground/14 bg-[image:var(--plate-raised-bg)] " +
  "shadow-[var(--plate-raised-shadow)]";

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
