"use client";

import type { ManagerLeague } from "@/shared/contract";
import type { FilterRule } from "@/features/shared";

import type { RulePreset } from "./league-filters-presets";
import { RuleRow, type RuleKeyOption } from "./rule-row";

/** Whether an identical rule is already on the list. */
function hasRule(rules: readonly FilterRule[], rule: FilterRule): boolean {
  return rules.some(
    (r) => r.key === rule.key && r.op === rule.op && r.value === rule.value,
  );
}

/**
 * The rule's own key where the menu didn't offer it — see
 * {@link RuleRow.extraKey}.
 */
function unlistedKey(
  options: readonly RuleKeyOption[],
  key: string,
): string | null {
  return options.some((option) => option.value === key) ? null : key;
}

/**
 * A list of rules the reader builds, in a bay of its own.
 *
 * The presets are as much the point of the shape as the rows are: they are the
 * questions worth one click, and they write a rule the reader can then edit into
 * the question they actually have. A preset already on the list stays in place
 * rather than being hidden, so the row doesn't reflow as you use it, and
 * pressing it again is a no-op rather than a duplicate rule that narrows nothing
 * twice.
 *
 * **An added preset is drawn *lit*, not dimmed** — the same treatment the filter
 * rails give a chosen option, which is also a no-op to press again. TheLabX
 * dims it, but its grammar has a raised/flat distinction this theme does not,
 * and the alternative here was an alpha on the accent: light mode's teal is only
 * ~5:1 against the page, so `text-active/40` is a label below AA. Lit is both
 * legible and *true* — the rule is on the list.
 *
 * `aria-disabled` rather than `disabled`: it is not an unavailable control but
 * one whose rule is already there, which is a fact worth being able to reach and
 * hear. `disabled` would remove it from the tab order and take the explanation
 * with it.
 *
 * One component for all three lists, because they differ in five values and no
 * behaviour: what the rows are called, what an empty one says, which keys they
 * name, which presets are on offer, and whether the number steps by a slot or by
 * half a point.
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
  keyOptions: readonly RuleKeyOption[];
  /** What the add button appends — the rule most readers want first. */
  newRule: FilterRule;
  presets: readonly RulePreset[];
  /** 1 for slot and settings counts, 0.5 for scoring rates. */
  step: number;
  leagues: readonly ManagerLeague[];
  match: (league: ManagerLeague, rule: FilterRule) => boolean;
}) {
  return (
    <section className="@container flex flex-col gap-2.5 rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3">
      <div className="flex items-center gap-2.5">
        {/* Full opacity on the accent: light mode's teal is only ~5:1 against
            the page, and an alpha drops a label below AA. */}
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-active">
          {label}
        </span>
        <span className="h-px flex-1 bg-foreground/10" />
        {rules.length > 0 && (
          <span className="text-[10px] font-semibold tabular-nums text-foreground/45">
            {rules.length}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {rules.length === 0 && (
          <p className="text-xs text-foreground/45">{empty}</p>
        )}
        {rules.map((rule, i) => (
          <RuleRow
            // Rules are only appended and removed, never reordered, and the row
            // holds no state a shifted index could carry over — see its `edit`.
            key={i}
            rule={rule}
            keyOptions={keyOptions}
            step={step}
            fallback={newRule.value}
            extraKey={unlistedKey(keyOptions, rule.key)}
            count={leagues.filter((l) => match(l, rule)).length}
            onChange={(next) =>
              onChange(rules.map((r, j) => (j === i ? next : r)))
            }
            onRemove={() => onChange(rules.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange([...rules, newRule])}
          // The `+` is decoration, so the name would otherwise be the bare noun
          // "Rule" — which says what the control is *about* rather than what
          // pressing it does.
          aria-label={`Add ${label.toLowerCase()} rule`}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-active/35 bg-active/[0.06] py-1.5 text-[11px] font-bold uppercase tracking-wider text-active transition-colors hover:bg-active/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            +
          </span>
          Rule
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
          Quick add
        </span>
        {presets.map((preset) => {
          const already = hasRule(rules, preset.rule);
          return (
            <button
              key={preset.label}
              type="button"
              aria-disabled={already || undefined}
              onClick={() => {
                if (already) return;
                onChange([...rules, preset.rule]);
              }}
              className={`rounded-lg border px-2 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50 ${
                already
                  ? "cursor-default border-active/40 bg-active/15 text-active"
                  : "border-foreground/12 bg-foreground/[0.04] text-foreground/65 hover:bg-foreground/[0.08] hover:text-foreground"
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
