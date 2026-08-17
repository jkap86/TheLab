/**
 * The one keyboard model behind an editable combobox with a list of suggestions
 * — ARIA's `combobox` + `listbox` pattern, as arithmetic.
 *
 * **What this exists to stop is a second interaction model growing inside the
 * popup.** The comps picker had one: the field handled ArrowUp/ArrowDown/Enter,
 * and each suggestion *also* carried a `<button>` handling `pointerdown`. Two
 * models over one control is not a redundancy, it is a contradiction — the
 * button was a tab stop per suggestion, Enter on one fired `click` where only
 * `pointerdown` was listened for (so it selected nothing at all), and a press
 * that moved focus off the field left `aria-activedescendant` naming an option
 * the field no longer owned. The cure is structural rather than a handler: **the
 * field is the only focusable part of a combobox**, the options are named
 * through `aria-activedescendant`, and everything a key can do is decided here.
 *
 * Pure, with no runtime imports at all, so a `"use client"` component reaches it
 * with a relative `.ts` import and the tests can run it directly — which is the
 * point, since every rule below is one whose failure is silent on screen. A
 * picker that quietly stops selecting on Enter renders perfectly.
 *
 * The ids are here for the same reason. `aria-activedescendant` is a *string
 * that has to match an `id` in the popup*, with nothing in the type system
 * relating the two ends: spell it in two places and it drifts to a reference
 * naming nothing, which no reader without a screen reader will ever see.
 */

/** Everything a keypress is decided against. */
export type ComboboxState = {
  /** Whether the popup is **on screen** — see the note on {@link comboboxKeyAction}. */
  readonly open: boolean;
  /** Which option is active, before clamping. */
  readonly activeIndex: number;
  /** How many options the popup is showing. */
  readonly count: number;
};

/**
 * What a keypress on the field means. `null` is every other key — which is most
 * of them, because the field is a text input first and a control second.
 *
 * `consume` is whether the press is the combobox's to spend (`preventDefault`).
 * Every action but one spends it: an arrow would otherwise run the caret to the
 * end of the query, and Enter would submit whatever form the picker is sitting
 * in. **Tab is the exception and the reason this field exists** — a combobox
 * that swallowed Tab would trap the reader in the picker, which is the bug this
 * whole module was written to remove rather than to relocate.
 */
export type ComboboxAction =
  | { readonly type: "open"; readonly consume: boolean }
  | { readonly type: "move"; readonly index: number; readonly consume: boolean }
  | { readonly type: "choose"; readonly index: number; readonly consume: boolean }
  | { readonly type: "close"; readonly consume: boolean };

/**
 * The active option, held inside the list it indexes.
 *
 * The stored index outlives the list it was chosen against — a query narrows
 * from twelve suggestions to two while the reader is on the sixth, and the
 * players prop arrives after a query has already been typed. Clamping at the
 * point of *reading* rather than trying to keep the stored number honest is
 * what makes those two cases the same case.
 */
export function clampActiveIndex(activeIndex: number, count: number): number {
  if (count <= 0) return 0;
  if (activeIndex < 0) return 0;
  return Math.min(activeIndex, count - 1);
}

/**
 * What a keypress means.
 *
 * **`open` means on screen, not merely intended.** A picker holds "the reader
 * has not dismissed this" and "there is something to show" as two facts, and
 * only their conjunction is what `aria-expanded` announces and what a key can
 * act on — otherwise Enter selects out of an invisible list, which is the one
 * failure here a reader cannot see coming.
 *
 * Three rules are worth stating because each of them is a decision rather than
 * an implementation:
 *
 * - **An arrow on a shut popup opens it and moves nothing.** Advancing as well
 *   skips the first suggestion, which is the one the reader is most likely to
 *   want and the one already highlighted.
 * - **The ends are walls, not a ring.** Arrowing past the last suggestion holds
 *   there; a wrap to the top reads as the list having jumped.
 * - **Home, End and Space are deliberately absent.** They are the listbox
 *   pattern's keys and this is a *text field* — Home and End move the caret
 *   through the query, and Space types one. A combobox that took them over
 *   would be unable to edit what it is searching for.
 */
export function comboboxKeyAction(
  key: string,
  state: ComboboxState,
): ComboboxAction | null {
  const { open, count } = state;
  const active = clampActiveIndex(state.activeIndex, count);

  // Both dismissals are answered before the count is consulted: a popup with
  // nothing in it is still a popup that has to shut.
  if (key === "Escape") return open ? { type: "close", consume: true } : null;
  if (key === "Tab") return open ? { type: "close", consume: false } : null;

  // Nothing to move through and nothing to choose. The press is left alone
  // rather than consumed, so the caret keys keep working in an empty search.
  if (count === 0) return null;

  if (key === "ArrowDown") {
    return open
      ? { type: "move", index: Math.min(active + 1, count - 1), consume: true }
      : { type: "open", consume: true };
  }
  if (key === "ArrowUp") {
    return open
      ? { type: "move", index: Math.max(active - 1, 0), consume: true }
      : { type: "open", consume: true };
  }
  if (key === "Enter") {
    return open ? { type: "choose", index: active, consume: true } : null;
  }
  return null;
}

/** The part of a `KeyboardEvent` the handler below reads. */
export type ComboboxKeyEvent = {
  readonly key: string;
  preventDefault: () => void;
};

/**
 * The field's whole keydown behaviour, composed but still free of the DOM.
 *
 * Its dependencies are thunks for the reason the drawer's are: **every one is
 * read at press time.** A picker re-creates this handler on each render, so the
 * indirection buys nothing *there* — it buys that the same implementation is
 * correct when a caller wires it once instead, and it costs a closure that was
 * already being allocated.
 *
 * `onChoose` is handed the option rather than its index, so no caller has to
 * re-index a list that may have changed under it.
 */
export function comboboxKeydownHandler<T>(deps: {
  /** Whether the popup is on screen as of this press. */
  isOpen: () => boolean;
  /** The options the popup is showing as of this press. */
  options: () => readonly T[];
  /** The active index as of this press, clamped here rather than by the caller. */
  activeIndex: () => number;
  onOpen: () => void;
  onActivate: (index: number) => void;
  onChoose: (option: T, index: number) => void;
  onClose: () => void;
}): (event: ComboboxKeyEvent) => void {
  return (event) => {
    const options = deps.options();
    const action = comboboxKeyAction(event.key, {
      open: deps.isOpen(),
      activeIndex: deps.activeIndex(),
      count: options.length,
    });
    if (action === null) return;
    if (action.consume) event.preventDefault();

    if (action.type === "open") return deps.onOpen();
    if (action.type === "close") return deps.onClose();
    if (action.type === "move") return deps.onActivate(action.index);

    // `choose` carries an index the action already clamped against this same
    // list, so the guard is belt-and-braces rather than a real branch — and it
    // is what keeps a miss silent instead of a crash inside a keydown handler.
    const option = options[action.index];
    if (option !== undefined) deps.onChoose(option, action.index);
  };
}

/**
 * The popup's id, off the field's `useId` base.
 *
 * One function rather than a template at each end, because `aria-controls` and
 * the `<ul>`'s own `id` are a matched pair with no compiler link between them.
 */
export function comboboxListboxId(baseId: string): string {
  return `${baseId}-listbox`;
}

/**
 * An option's id, keyed by **what the option is** rather than where it sits.
 *
 * A positional id (`…-option-3`) is a different suggestion on every keystroke,
 * so an assistive technology that caches by id is told the fourth row changed
 * name rather than that the list was replaced — and `aria-activedescendant`
 * pointing at a stable string that means something new is worse than pointing
 * at nothing. The key must be unique within one popup and stable across
 * re-ranking; a domain id (a Sleeper player id, a league id) is both.
 */
export function comboboxOptionId(baseId: string, key: string): string {
  return `${baseId}-option-${key}`;
}

/**
 * What the field publishes as `aria-activedescendant`, or `undefined` when
 * there is no option to name.
 *
 * Built from the same {@link comboboxOptionId} the popup stamps on its rows, so
 * the reference and the id it resolves to cannot be spelled differently. It
 * answers `undefined` rather than the empty string: an absent attribute is "no
 * active option", where `aria-activedescendant=""` is a reference that fails.
 */
export function comboboxActiveDescendant<T>(
  baseId: string,
  options: readonly T[],
  activeIndex: number,
  keyOf: (option: T) => string,
): string | undefined {
  const option = options[clampActiveIndex(activeIndex, options.length)];
  return option === undefined ? undefined : comboboxOptionId(baseId, keyOf(option));
}
