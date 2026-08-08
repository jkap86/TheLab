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
 * A row of fixed keys a caller may drop from the panel.
 *
 * **Both entries are the same argument** — the caller already asks that question
 * with a control of its own, and two controls over one axis disagree in a way
 * that reads as a bug rather than a selection. The ADP board owns both: its
 * board keys choose the redraft or dynasty column, so narrowing the *population*
 * on type as well is an empty column with nothing on screen saying which control
 * emptied it; and its pinned block leads with a season row that decides which
 * leagues are fetched at all, so a second season inside the dialog would be a
 * finer cut on an axis already answered a few pixels above.
 *
 * It was `omitType`, a boolean, until the second instance turned up. A row is
 * dropped and not a *field*: nothing about `LeagueFilters` changes, the other
 * callers keep both rows, and the match rail still names and clears a value that
 * somehow arrived — which is what keeps this from being a filter a reader cannot
 * see or undo.
 */
export type LeagueFilterRow = "season" | "type";

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
