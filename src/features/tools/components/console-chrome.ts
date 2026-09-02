/*
 * The console's shared surfaces, as class strings.
 *
 * A key is a physically raised object: the resting shadow carries a 3px riser
 * under it and the pressed shadow drops to 1px, so pressing one travels. Three
 * of them exist — Find, Change and the theme toggle — and they have to agree,
 * which is the whole argument for the constant.
 */
export const CONSOLE_KEY =
  "shrink-0 rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-4 py-2 " +
  "font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/80 " +
  "shadow-[var(--key-shadow)] transition-[transform,box-shadow,color] duration-150 " +
  "hover:text-readout active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";

/** The machined housing a key or a readout is mounted in. */
export const CONSOLE_HOUSING =
  "inline-flex items-center rounded-full border border-foreground/8 " +
  "bg-[image:var(--key-bg)] p-1.5 shadow-[var(--plate-shadow)]";
