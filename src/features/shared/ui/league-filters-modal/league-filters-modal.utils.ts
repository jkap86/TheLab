import type { ActiveFilter, FilterRule } from "../../league-filters";
import type { RuleKeyOption } from "./league-filters-modal.types.ts";

/**
 * The decisions the dialog's markup used to make inline.
 *
 * Every one of them was a line inside a JSX expression — a rule list rebuilt in
 * a `.map`, an "is this option narrowing anything" comparison, the keystroke a
 * numeric field will and won't accept — and none of them could be checked
 * without a browser, because the only way to reach them was to render the
 * component that held them. They are the same expressions here, called from the
 * same places, and now each is a function with a name and a test.
 *
 * **Type-only imports, so this module is erased from the chunk.** That is what
 * makes it the folder's tested half: it resolves under Node's runner with
 * nothing to stand up, exactly as `league-filters/types.ts` does. Anything
 * needing a predicate, an option table or React belongs in a section instead —
 * the counting each control does is a `matchesFilters` walk over the caller's
 * own leagues, which is a different predicate in all three places and would be
 * a worse function for being one.
 */

/**
 * A rule is addressed by position, so two identical rules need distinguishing
 * keys — which the index gives and the label doesn't.
 */
export function chipKey(entry: ActiveFilter): string {
  return entry.kind === "fixed"
    ? `fixed:${entry.field}`
    : `${entry.kind}:${entry.index}`;
}

/**
 * Whether two rules say the same thing.
 *
 * All three fields, because a rule *is* its three fields: `rec ≥ 1` and
 * `rec = 1` are different questions, and a quick-add that matched on the key
 * alone would refuse to add the second once the first was on the list.
 */
export function sameRule(a: FilterRule, b: FilterRule): boolean {
  return a.key === b.key && a.op === b.op && a.value === b.value;
}

/**
 * Whether a preset is already on the list — which dims it rather than hiding
 * it, so the quick-add row doesn't reflow as it is used.
 */
export function hasRule(
  rules: readonly FilterRule[],
  rule: FilterRule,
): boolean {
  return rules.some((existing) => sameRule(existing, rule));
}

/** The list with one more rule on the end. */
export function appendRule(
  rules: readonly FilterRule[],
  rule: FilterRule,
): FilterRule[] {
  return [...rules, rule];
}

/**
 * The list with the rule at `index` swapped for another.
 *
 * By position rather than by identity for the reason `clearFilter` addresses
 * one that way: two identical rules are indistinguishable, so "replace the
 * matching one" has no answer.
 */
export function replaceRule(
  rules: readonly FilterRule[],
  index: number,
  rule: FilterRule,
): FilterRule[] {
  return rules.map((existing, i) => (i === index ? rule : existing));
}

/** The list without the rule at `index`. */
export function removeRule(
  rules: readonly FilterRule[],
  index: number,
): FilterRule[] {
  return rules.filter((_, i) => i !== index);
}

/**
 * The rule's own key, when the menu it is being drawn in doesn't offer it.
 *
 * A preset can write a key no league in view scores (`bonus_rec_te` where
 * nobody pays it), and a `<select>` whose value isn't among its options
 * silently shows the first one instead — which is a row quietly filtering on
 * something other than what it reads. `null` is the ordinary case: the key is
 * on the menu and needs no entry of its own.
 */
export function unlistedKey(
  options: readonly RuleKeyOption[],
  key: string,
): string | null {
  return options.some((option) => option.value === key) ? null : key;
}

/**
 * The matched count as a share of the account it came out of, for the rail's
 * meter and its percentage.
 *
 * A cold load has no leagues to be a share of, and 0/0 is not 0% — it is a
 * question with no answer yet, so both sit it out on `null`.
 */
export function matchShare(matched: number, total: number): number | null {
  return total > 0 ? matched / total : null;
}

/**
 * The number a keystroke in a rule's value field means, or `null` for one that
 * means nothing yet.
 *
 * A controlled numeric field parsed on every keystroke can't be cleared —
 * emptying it to type `12` would snap to 0 and leave you typing `012` — so a
 * blank field writes no value at all and the rule keeps the one it had. Blank
 * is the whole reason this isn't a bare `Number()`: `Number("")` is 0, which is
 * a real value and the wrong one.
 *
 * A half-typed `0.` *does* parse, to 0, and that is deliberate — a rule at 0
 * narrows nothing, where leaving it un-written on a `NaN` would match nothing
 * and read as the filter having emptied the list.
 */
export function parseRuleValue(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether a completed press was a press on the backdrop.
 *
 * The backdrop is the dialog's own pseudo-element, so what a press outside the
 * panel actually lands on is the `<dialog>` box itself — the gesture the
 * platform doesn't wire up for you. What it *also* doesn't tell you is where the
 * press began, and that is why this takes both ends: a `click` fires on the
 * nearest common ancestor of where the pointer went down and where it came up,
 * so selecting text inside the panel and releasing past its edge reports the
 * dialog as the target and used to close the modal — discarding the draft the
 * reader was in the middle of editing. Requiring the press to have *started*
 * there is what separates the two.
 *
 * `unknown` rather than `EventTarget`, so this stays free of the DOM like the
 * rest of the module; identity is the whole of what it reads.
 */
export function isBackdropPress(
  dialog: unknown,
  pressedTarget: unknown,
  releasedTarget: unknown,
): boolean {
  if (dialog === null || dialog === undefined) return false;
  return pressedTarget === dialog && releasedTarget === dialog;
}
