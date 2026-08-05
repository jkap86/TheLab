/**
 * The drawer's modal keyboard rules, as arithmetic over structural types.
 *
 * A modal owes three things beyond looking like one: Escape closes the innermost
 * thing that is up, Tab never leaves it, and closing hands focus back to whatever
 * opened it. All three used to be spelled inline in an effect, where nothing
 * could reach them — the same reason the drawer's wording moved to
 * `adp-drawer.utils`.
 *
 * **Every export here takes the smallest shape it actually reads, not
 * `HTMLElement`.** That is what lets the rules be tested at all: the test runner
 * is Node's, with no DOM behind it, so a rule that named `HTMLElement` could only
 * be checked by rendering one. A real element satisfies each of these shapes
 * structurally, so the hook passes the DOM straight in and no cast is involved
 * at either end.
 */

/**
 * Everything that can hold a tab stop. It is deliberately broad — the filter
 * chips are `<select>`s, the keys are `<button>`s, the lookback counter holds
 * text and date `<input>`s, and the panel is free to grow another kind — so the
 * narrowing is done by {@link isTabbable} below rather than by the selector
 * enumerating what the drawer happens to contain today.
 */
export const TABBABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "iframe",
  "object",
  "embed",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]",
  "[tabindex]",
].join(",");

/** What {@link isTabbable} reads off a candidate. */
export type TabbableLike = {
  matches: (selectors: string) => boolean;
  getAttribute: (name: string) => string | null;
  getClientRects: () => { length: number };
};

/**
 * Whether a candidate is somewhere Tab can actually land.
 *
 * Every check is a way an element can match the selector above and still not be
 * somewhere Tab lands. A negative `tabindex` opts out of the sequence — the
 * dialog panel carries `-1`, which is what keeps the focus move on open from
 * parking the reader mid-list. `:disabled` covers a disabled control *and* one
 * inside a disabled `<fieldset>`, which no attribute check would. `[inert]` is
 * matched with its subtree, since inertness inherits and the attribute sits on
 * the ancestor. `[contenteditable]` in the selector has to take
 * `contenteditable="false"` with it, so that one is subtracted back out here.
 * And no client rects is how `display: none` reads from the outside.
 */
export function isTabbable(el: TabbableLike): boolean {
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null && Number(tabindex) < 0) return false;
  if (el.matches(":disabled")) return false;
  if (el.matches("[inert], [inert] *")) return false;
  if (el.matches('[contenteditable="false"]')) return false;
  return el.getClientRects().length > 0;
}

/** The stops among `nodes`, in document order — the order Tab would visit them. */
export function tabbableStops<T extends TabbableLike>(nodes: Iterable<T>): T[] {
  return [...nodes].filter(isTabbable);
}

/**
 * Where Tab should go, given how many stops the dialog holds and which one has
 * focus (`-1` for focus anywhere else, which includes the dialog panel itself
 * and anything outside it — the scrim, or the page behind).
 *
 * `null` means **do not intervene**: focus is mid-list and the browser's own
 * sequence is already right, so the handler leaves the event alone rather than
 * re-implementing tab order. The two wraps and the "focus is not on a stop" case
 * are the only presses a trap has any business taking.
 *
 * `"container"` is the empty dialog: with nothing tabbable inside, focus has to
 * stay on the panel or the press escapes to the page behind — which is the one
 * thing a modal must not allow.
 */
export type TabStopMove = "container" | number | null;

export function tabWrap(
  count: number,
  active: number,
  backwards: boolean,
): TabStopMove {
  if (count <= 0) return "container";
  // Focus is somewhere the trap doesn't own, so the next press pulls it back in
  // at whichever end the direction implies.
  if (active < 0 || active >= count) return backwards ? count - 1 : 0;
  if (backwards) return active === 0 ? count - 1 : null;
  return active === count - 1 ? 0 : null;
}

/**
 * What a keypress means while the drawer is open. `null` is every other key,
 * which the drawer has no opinion about.
 *
 * Escape's two answers are the reason this takes `panelOpen` at all: **Escape
 * closes the innermost thing that is up**, so a window panel or filter tray
 * floating over the board goes first and the drawer survives the press. Without
 * it one keystroke takes both.
 */
export type DrawerKeyAction =
  | { readonly type: "close-panel" }
  | { readonly type: "close-drawer" }
  | { readonly type: "trap-tab"; readonly backwards: boolean };

export function drawerKeyAction(
  key: string,
  shiftKey: boolean,
  panelOpen: boolean,
): DrawerKeyAction | null {
  if (key === "Escape") {
    return panelOpen ? { type: "close-panel" } : { type: "close-drawer" };
  }
  if (key === "Tab") return { type: "trap-tab", backwards: shiftKey };
  return null;
}

/** The part of a `KeyboardEvent` the handler below reads. */
export type DrawerKeyEvent = {
  readonly key: string;
  readonly shiftKey: boolean;
  preventDefault: () => void;
};

/**
 * The drawer's whole keydown behaviour, composed but still free of the DOM.
 *
 * Its dependencies are thunks rather than values because **every one of them is
 * read at press time, not at wiring time**. The listener is attached once per
 * open, and between two presses the reader can open the filter tray (six more
 * stops), open the lookback panel (more again), or move focus anywhere at all —
 * so a handler closing over a snapshot would trap them outside the control they
 * had just opened. That is also what keeps the effect keyed on `open` alone:
 * nothing here has to be rebuilt when the drawer's contents change.
 */
export function drawerKeydownHandler<T extends { focus: () => void }>(deps: {
  /** The dialog's tab stops, in order, as of this press. */
  stops: () => readonly T[];
  /** Focus as of this press, or null when it is not on a stop. */
  activeElement: () => T | null;
  /** The dialog panel itself — the fallback when it holds no stops. */
  focusContainer: () => void;
  /** Whether a floating panel is up, which is what Escape asks. */
  panelOpen: () => boolean;
  closePanel: () => void;
  closeDrawer: () => void;
}): (event: DrawerKeyEvent) => void {
  return (event) => {
    const action = drawerKeyAction(event.key, event.shiftKey, deps.panelOpen());
    if (action === null) return;
    if (action.type === "close-panel") return deps.closePanel();
    if (action.type === "close-drawer") return deps.closeDrawer();

    const stops = deps.stops();
    const active = deps.activeElement();
    const at = active === null ? -1 : stops.indexOf(active);
    const move = tabWrap(stops.length, at, action.backwards);
    // Mid-list: the browser's own sequence is already right, so the press is
    // left alone rather than re-implemented.
    if (move === null) return;
    event.preventDefault();
    if (move === "container") deps.focusContainer();
    else stops[move].focus();
  };
}

/** What {@link restoreFocus} reads off the element it is handing focus back to. */
export type RestoreTarget = {
  readonly isConnected: boolean;
  focus: () => void;
  matches: (selectors: string) => boolean;
};

/**
 * Hand focus back to whatever held it when the drawer opened — the trigger, in
 * every real case. Returns whether it landed, which is what the tests read.
 *
 * A saved element is a reference held across the whole life of the drawer, so by
 * the time it is used it may be none of the things it was. Three refusals, and
 * each is a state that really occurs: the element is **gone** (a re-render or a
 * navigation dropped it, and focusing a detached node silently drops the reader
 * on `<body>` — worse than leaving focus where it is), it is **disabled** (the
 * trigger is disabled while its own data reloads), or the call **throws**.
 * Focus is a courtesy; a target that refuses it must not send an exception back
 * up through the keydown handler that asked.
 */
export function restoreFocus(target: RestoreTarget | null): boolean {
  if (target === null || !target.isConnected) return false;
  try {
    if (target.matches(":disabled")) return false;
    target.focus();
    return true;
  } catch {
    return false;
  }
}

/** What {@link lockScroll} writes to — `document.body`, in the one real caller. */
export type ScrollLockTarget = { style: { overflow: string } };

/**
 * Stop the page behind scrolling, and hand back the undo.
 *
 * It restores **what was there** rather than clearing the property, so a page
 * that sets its own `overflow` gets it back; and it is a function rather than a
 * pair of calls so the effect's cleanup cannot forget which value that was —
 * which is the bug that leaves a page permanently unscrollable after a drawer is
 * unmounted mid-exit.
 */
export function lockScroll(target: ScrollLockTarget): () => void {
  const previous = target.style.overflow;
  target.style.overflow = "hidden";
  return () => {
    target.style.overflow = previous;
  };
}
