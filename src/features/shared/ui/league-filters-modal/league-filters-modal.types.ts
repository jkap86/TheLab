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

/** Which of the three fixed filters a row edits — the open-state's identity. */
export type SegmentKey = "status" | "type" | "format";

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
