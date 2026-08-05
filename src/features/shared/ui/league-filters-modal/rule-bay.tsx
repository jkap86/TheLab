import type { FilterRule } from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import { CAPTION } from "./league-filters-modal.constants.ts";
import type {
  RuleKeyOption,
  RulePreset,
} from "./league-filters-modal.types.ts";
import {
  appendRule,
  hasRule,
  removeRule,
  replaceRule,
  unlistedKey,
} from "./league-filters-modal.utils.ts";
import { RuleRow } from "./rule-row.tsx";

/**
 * A list of rules the reader builds, in a bay of its own.
 *
 * The presets are the point of the shape as much as the rows are: the four fixed
 * pairs this replaced were the four questions worth one click, and they still are
 * — they just write a rule now, which the reader can then edit into the question
 * they actually have (`rec = 0.5` becomes `rec ≥ 0.4`; `qb+sf ≥ 2` becomes
 * `qb+sf = 3`). A preset already on the list is dimmed rather than hidden, so the
 * row doesn't reflow as you use it, and clicking it again is a no-op rather than
 * a duplicate rule that narrows nothing twice.
 *
 * A dimmed preset is drawn **flat**, where a live one is a raised key. That is
 * the app bar's grammar held to at the smallest size: a part that does nothing
 * when pressed must not look pressable. The live ones are half the thickness of
 * a segment key, since a shortcut is a lesser press than the filter it writes.
 *
 * One component for both lists, because the two differ in four values and no
 * behaviour: what the rows are called, what a new one says, which presets are on
 * offer, and whether the number steps by a slot or by half a point.
 */
export function RuleBay({
  label,
  empty,
  rules,
  onChange,
  keyOptions,
  newRule,
  presets,
  step,
  leagues,
  match,
}: {
  label: string;
  empty: string;
  rules: readonly FilterRule[];
  onChange: (rules: FilterRule[]) => void;
  keyOptions: RuleKeyOption[];
  /** What the add button appends — the rule most readers want first. */
  newRule: FilterRule;
  presets: RulePreset[];
  /** 1 for slot counts, 0.5 for scoring rates. */
  step: number;
  leagues: readonly ManagerLeague[];
  match: (league: ManagerLeague, rule: FilterRule) => boolean;
}) {
  return (
    <section className="lab-well flex flex-col gap-3 rounded-xl p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-active/75">
          {label}
        </span>
        <span className="h-px flex-1 bg-foreground/10" />
        {rules.length > 0 && <span className={CAPTION}>{rules.length}</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        {rules.length === 0 && (
          <p className="text-xs text-foreground/35">{empty}</p>
        )}
        {rules.map((rule, i) => (
          <RuleRow
            // Rules are only appended and removed, never reordered, and the row
            // holds no state of its own that a shifted index could carry over.
            key={i}
            rule={rule}
            keyOptions={keyOptions}
            step={step}
            // A preset can write a key no league in view scores (`bonus_rec_te`
            // where nobody pays it), and a select whose value isn't among its
            // options silently shows the first one instead — so the rule's own
            // key is always an option, whatever the data offered.
            extraKey={unlistedKey(keyOptions, rule.key)}
            count={leagues.filter((l) => match(l, rule)).length}
            onChange={(next) => onChange(replaceRule(rules, i, next))}
            onRemove={() => onChange(removeRule(rules, i))}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange(appendRule(rules, newRule))}
          // The `+` is decoration, so the name would otherwise be the bare noun
          // "Rule" — which says what the control is *about* rather than what
          // pressing it does. The visible word is inside the label, so the
          // spoken and written names still agree.
          aria-label={`Add ${label.toLowerCase()} rule`}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-active/35 bg-active/[0.06] py-1.5 text-[11px] font-bold uppercase tracking-wider text-active transition-colors hover:bg-active/15"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            +
          </span>
          Rule
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={CAPTION}>Quick add</span>
        {presets.map((preset) => {
          const already = hasRule(rules, preset.rule);
          return (
            <button
              key={preset.label}
              type="button"
              // `aria-disabled` rather than `disabled`, which is the difference
              // between a key a reader can find and one that isn't there. A
              // dimmed preset is not an unavailable control — it is one whose
              // rule is *already on the list*, which is a fact worth being able
              // to reach and hear. `disabled` removed it from the tab order and
              // took the explanation with it.
              aria-disabled={already || undefined}
              onClick={() => {
                if (already) return;
                onChange(appendRule(rules, preset.rule));
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                already
                  ? "cursor-default bg-active/[0.07] text-active/40 shadow-[inset_0_0_0_1px_rgba(0,255,229,0.18)]"
                  : "lab-chip lab-chip-sm text-foreground/60 hover:text-foreground"
              }`}
            >
              {preset.label}
              {already && <span className="sr-only"> — already added</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
