import type { FilterRule } from "../../league-filters";

/**
 * The vocabulary this folder's sections are written in — and nothing that reads
 * or builds it.
 *
 * The same arrangement as `league-filters/types.ts` one package over, and for
 * the same reason: everything here depends on this module and this module
 * depends on nothing but the filter vocabulary itself, so a section that only
 * threads a shape around pulls in no option tables and no presets. Types only,
 * so it is erased entirely from the dialog's chunk.
 */

/**
 * Which fixed filter a row edits — the open-state's identity.
 *
 * `extra` is the caller's own row (see {@link ExtraSegment}), which is a fourth
 * identity rather than a second mechanism: one row floats at a time, and a slot
 * the dialog didn't name would be a row that couldn't take part in that.
 */
export type SegmentKey = "status" | "type" | "format" | "extra";

/**
 * A fourth segment row the caller owns, drafted and applied with the filters.
 *
 * **One caller has one**, and it is worth reading as the exception it is: the ADP
 * board's filters *are* the league filters now, and the one thing left over is
 * what kind of draft to average — startup or rookie — which is a fact about the
 * room rather than about the league, so it has no business in `LeagueFilters`
 * where the manager tabs and the trades board would inherit a control that means
 * nothing to them. Seating it here instead of beside the trigger is what makes
 * the board's filters one dialog rather than a dialog and a stray chip.
 *
 * It rides the dialog's own draft/apply contract rather than committing live:
 * `value` seeds a draft on open, the row edits that draft, and `onApply` is
 * called beside `onChange` when Apply is pressed. Reset returns it to
 * `defaultValue`. Half-committing it would be the one control in the panel that
 * moved the board while the counts beside it were being read.
 */
export type ExtraSegment = {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  /** What Reset puts it back to — the caller's default, not necessarily the first option. */
  defaultValue: string;
  onApply: (value: string) => void;
};

/**
 * One entry in a rule row's key menu.
 *
 * Both bays fill this from a different place — the slot bay from `SLOT_GROUPS`,
 * the scoring bay from whatever keys the leagues in hand actually pay for — so
 * the row can render either without knowing which it was handed. `hint` is the
 * option's `title`, which only the slot groups carry.
 */
export type RuleKeyOption = {
  value: string;
  label: string;
  hint?: string;
};

/**
 * A one-click rule: the fixed chips this dialog's rule lists replaced, as the
 * rules they always were.
 */
export type RulePreset = { label: string; rule: FilterRule };
