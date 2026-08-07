import { useState } from "react";

import { mobileInputText } from "../../control-type.ts";
import { COMPARE_OPS, type FilterRule, formatRuleValue } from "../../league-filters";

import type { RuleKeyOption } from "./league-filters-modal.types.ts";
import { parseRuleValue } from "./league-filters-modal.utils.ts";

/**
 * One rule: what to measure, how to compare it, and to what.
 *
 * The number is held as text *only while it's being edited*, because a controlled
 * numeric field parsed on every keystroke can't be cleared — emptying it to type
 * `12` would snap to 0 and leave you typing `012`. The rule only takes a value a
 * keystroke actually parses to, so a half-typed `0.` narrows nothing rather than
 * matching nothing. The override drops on blur rather than living for the row's
 * lifetime: rows are keyed by position, so a removal shifts a rule under a
 * surviving row, and a permanent text buffer would show the deleted row's number
 * against the kept row's rule.
 *
 * The trailing count is what this rule *alone* leaves, not what the draft leaves
 * — the rail states that. Per rule it is the answer to "is this the rule that
 * emptied my list", which a running total can't give once there are three of them.
 *
 * The row sits at half a bay's width, so its parts are sized rather than left to
 * flex: everything but the key menu takes exactly what its content needs, and the
 * menu takes the rest. A long scoring key truncates, which is the trade the
 * two-column bay makes.
 */
export function RuleRow({
  rule,
  keyOptions,
  extraKey,
  step,
  count,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  keyOptions: RuleKeyOption[];
  extraKey: string | null;
  step: number;
  count: number;
  onChange: (rule: FilterRule) => void;
  onRemove: () => void;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const text = edit ?? formatRuleValue(rule.value);

  // Inset parts, laid in the bay's trough: a control you type into is a slot,
  // not a key. The dark face and the top shadow are what say so.
  //
  // One string for all three, which is why it carries the input token and not
  // the select one — they are the same 16px, and a row that spelled its floor
  // twice would be a row where one of them could drift. The padding is
  // untouched: this row's width is absorbed by the key menu (`flex-1
  // min-w-0`), so the wider type costs it nothing, and pinning the line box is
  // what keeps the row at the 44px it was drawn at.
  const inset =
    `rounded-md border border-foreground/10 bg-[#06111b] px-1.5 py-1 ${mobileInputText} font-bold text-foreground shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] outline-none focus-visible:border-active/60`;

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.05] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <select
        aria-label="Filter on"
        value={rule.key}
        onChange={(e) => onChange({ ...rule, key: e.target.value })}
        className={`min-w-0 flex-1 truncate ${inset}`}
      >
        {extraKey !== null && (
          <option value={extraKey}>{extraKey.replace(/_/g, " ")}</option>
        )}
        {keyOptions.map((option) => (
          <option key={option.value} value={option.value} title={option.hint}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Comparison"
        value={rule.op}
        onChange={(e) =>
          onChange({ ...rule, op: e.target.value as FilterRule["op"] })
        }
        className={`shrink-0 text-center text-active ${inset}`}
      >
        {COMPARE_OPS.map((op) => (
          <option key={op.value} value={op.value} aria-label={op.label}>
            {op.symbol}
          </option>
        ))}
      </select>

      <input
        aria-label="Value"
        type="number"
        inputMode="decimal"
        step={step}
        value={text}
        onChange={(e) => {
          setEdit(e.target.value);
          const parsed = parseRuleValue(e.target.value);
          if (parsed !== null) {
            onChange({ ...rule, value: parsed });
          }
        }}
        onBlur={() => setEdit(null)}
        // The spinners would eat a third of a field this narrow, and the step is
        // reachable from the keyboard either way.
        className={`w-13 shrink-0 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${inset}`}
      />

      <span
        title="Leagues matching this rule on its own"
        className="w-6 shrink-0 text-center font-mono text-[10px] tabular-nums text-foreground/35"
      >
        {count}
      </span>

      <button
        type="button"
        // Named by the rule it removes: a bay can hold half a dozen of these
        // and "Remove rule" six times over is a list a reader has to count
        // through.
        aria-label={`Remove rule ${rule.key} ${rule.op} ${formatRuleValue(rule.value)}`}
        onClick={onRemove}
        className="shrink-0 rounded-md border border-foreground/10 px-1.5 py-1 text-sm font-bold leading-none text-foreground/40 transition-colors hover:border-[#ff5f6d]/50 hover:text-[#ff5f6d]"
      >
        ×
      </button>
    </div>
  );
}
