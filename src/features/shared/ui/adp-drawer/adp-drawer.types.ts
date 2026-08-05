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
 * Which of the drawer's two expanding controls is up, as one selection rather
 * than two booleans. They can't both be: the window's panel *floats* over the
 * rows below it, so an open filter tray under it would be a control the reader
 * can see and can't reach — and one-open-at-a-time is what the league filters'
 * own floating rows do, for the same reason. `null` is neither.
 */
export type AdpDrawerPanel = "range" | "filters";
