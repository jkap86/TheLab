import type { AdpControls } from "../../adp-controls";

/**
 * The board's filters, as a table rather than six hand-written controls.
 *
 * They are read as a list — only the ones actually narrowing the board are on
 * screen, and the rest are behind one key — so the row has to be able to say
 * *which* those are. `get` and `set` are what keeps that type-safe without a
 * computed key: each entry names its own field, so a value can only be written
 * back to the field it was read from.
 */
export type FilterSpec = {
  key: string;
  ariaLabel: string;
  options: readonly { value: string; label: string }[];
  get: (c: AdpControls) => string;
  set: (c: AdpControls, value: string) => AdpControls;
};

/**
 * Which of the drawer's floating controls is up; `null` is none.
 *
 * There were two — the window's counter and the filter tray — and it was one
 * selection rather than two booleans because they could not both be up: a panel
 * that *floats* over the rows below it would leave an open tray underneath as a
 * control the reader can see and cannot reach. The window is expanded in place
 * now and floats over nothing, so this is a union of one.
 *
 * It stays a named slot rather than collapsing into a boolean because the
 * question the lifecycle hook asks of it is *which* panel is up, not whether one
 * is: that is what Escape's innermost-first rule is written against, and a
 * second floating control arriving as its own boolean is exactly the
 * two-at-once state this shape makes unrepresentable.
 */
export type AdpDrawerPanel = "filters";
