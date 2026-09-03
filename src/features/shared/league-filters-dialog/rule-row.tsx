"use client";

import { useState } from "react";

import {
  COMPARE_OPS,
  type FilterRule,
  formatRuleValue,
  isSentinelRule,
  settingSentinel,
  settingValueOptions,
} from "../league-filters";

/** One entry of a rule's key menu. */
export type RuleKeyOption = { value: string; label: string; hint?: string };

/**
 * The comparisons a rule over *named* numbers can make.
 *
 * `>` on an enum is a question with no meaning, and offering it is how a reader
 * builds a rule that reads as a sentence and narrows by an accident of the
 * coding. Taken from the one table rather than spelled again, so a symbol
 * changed there changes here.
 */
const NAMED_OPS = COMPARE_OPS.filter(
  (op) => op.value === "eq" || op.value === "ne",
);

/** A rule's number as typed, or the fallback for a half-typed one. */
function parseRuleValue(text: string, fallback: number): number {
  const parsed = Number(text);
  return text.trim() !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * One rule: what to measure, how to compare it, and to what.
 *
 * **The number is held as text only while it is being edited.** A controlled
 * numeric field parsed on every keystroke cannot be cleared — emptying it to
 * type `12` would snap to 0 and leave you typing `012`. The rule only takes a
 * value a keystroke actually parses to, so a half-typed `0.` narrows nothing
 * rather than matching nothing. The override drops on blur rather than living
 * for the row's lifetime: rows are keyed by position, so a removal shifts a rule
 * under a surviving row, and a permanent text buffer would show the deleted
 * row's number against the kept row's rule.
 *
 * **Where a key's numbers are names, the value is a menu and the comparison is
 * is / is not.** `disable_trades = 1` is correct and unreadable: nothing on
 * screen says which digit is which. Same `FilterRule` underneath — a key, an op
 * and a number, compared with the same epsilon — so only the *rendering* moves.
 *
 * **A sentinel gets a key of its own rather than a menu entry**, which is the
 * difference between the second value kind and the third. A label key is only
 * names, so a menu loses nothing; `trade_deadline` is a real scale with one
 * value beside it, and a menu that swallowed the weeks could only offer the ones
 * someone thought of. So the row keeps its number field and puts `No deadline`
 * next to it: lit, it *is* the value and the field stands down; unlit, it is the
 * way in. Both halves are needed, because `settingValue` reads 99 as an absence
 * the moment it stops comparing as a week.
 *
 * The trailing count is what this rule *alone* leaves, not what the draft leaves
 * — the rail states that. Per rule it is the answer to "is this the rule that
 * emptied my list", which a running total can't give once there are three.
 */
export function RuleRow({
  rule,
  keyOptions,
  extraKey,
  step,
  fallback,
  count,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  keyOptions: readonly RuleKeyOption[];
  /**
   * The rule's own key, where the data didn't offer it — a preset can write
   * `bonus_rec_te` in an account where nobody pays it, and a `<select>` whose
   * value isn't among its options silently shows the first one instead.
   */
  extraKey: string | null;
  /** 1 for slot and settings counts, 0.5 for scoring rates. */
  step: number;
  /**
   * The number a rule opens on in this bay, which is what leaving a sentinel
   * returns to. Remembering the week typed before the sentinel was pressed
   * would be a second piece of row state for a press most readers make once —
   * and 99 is the one number the field must not come back carrying.
   */
  fallback: number;
  count: number;
  onChange: (rule: FilterRule) => void;
  onRemove: () => void;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const text = edit ?? formatRuleValue(rule.value);
  const named = settingValueOptions(rule.key);
  const sentinel = settingSentinel(rule.key);
  // Lit, the sentinel *is* the value, so the number field stands down and the
  // comparison narrows with it.
  const onSentinel = isSentinelRule(rule);
  const ops = named || onSentinel ? NAMED_OPS : COMPARE_OPS;

  // One string for all three inset controls, so the row cannot drift into two
  // heights. 16px on the input specifically: anything smaller makes iOS Safari
  // zoom the page on focus.
  const inset =
    "min-w-0 rounded-md border border-foreground/12 bg-foreground/[0.06] px-1.5 py-1 text-[16px] font-semibold text-foreground outline-none focus-visible:border-active/60 @md:text-xs";

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={rule.key}
        aria-label="Measure"
        onChange={(e) => {
          // The op may not survive the new key — a named or sentinel key admits
          // only is / is not, and carrying a `≥` over would build a rule the row
          // cannot draw.
          const key = e.target.value;
          const keeps =
            settingValueOptions(key) === null
              ? true
              : rule.op === "eq" || rule.op === "ne";
          onChange({ ...rule, key, op: keeps ? rule.op : "eq" });
        }}
        className={`${inset} max-w-[15rem] flex-1 truncate`}
      >
        {extraKey !== null && <option value={extraKey}>{extraKey}</option>}
        {keyOptions.map((option) => (
          <option key={option.value} value={option.value} title={option.hint}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        value={rule.op}
        aria-label="Comparison"
        onChange={(e) =>
          onChange({ ...rule, op: e.target.value as FilterRule["op"] })
        }
        className={`${inset} shrink-0`}
      >
        {ops.map((op) => (
          <option key={op.value} value={op.value} aria-label={op.label}>
            {op.symbol}
          </option>
        ))}
      </select>

      {named ? (
        <select
          value={String(rule.value)}
          aria-label="Value"
          onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
          className={`${inset} shrink-0`}
        >
          {named.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={onSentinel ? "" : text}
          disabled={onSentinel}
          aria-label="Value"
          onChange={(e) => {
            setEdit(e.target.value);
            onChange({
              ...rule,
              value: parseRuleValue(e.target.value, rule.value),
            });
          }}
          onBlur={() => setEdit(null)}
          className={`${inset} w-16 shrink-0 tabular-nums disabled:opacity-40`}
        />
      )}

      {sentinel && (
        <button
          type="button"
          aria-pressed={onSentinel}
          title={`${sentinel.label} — not a value on this scale`}
          onClick={() =>
            onChange(
              onSentinel
                ? { ...rule, value: fallback }
                : { ...rule, op: "eq", value: sentinel.value },
            )
          }
          className={`shrink-0 whitespace-nowrap rounded-md border px-1.5 py-1 text-[11px] font-semibold transition-colors ${
            onSentinel
              ? "border-active/40 bg-active/15 text-active"
              : "border-foreground/12 text-foreground/55 hover:bg-foreground/[0.08]"
          }`}
        >
          {sentinel.label}
        </button>
      )}

      <span
        title="Leagues matching this rule on its own"
        className="ml-auto shrink-0 text-[11px] tabular-nums text-foreground/45"
      >
        {count}
      </span>

      <button
        type="button"
        aria-label="Remove rule"
        onClick={onRemove}
        className="shrink-0 rounded-md px-1.5 py-1 text-sm leading-none text-foreground/40 transition-colors hover:bg-foreground/[0.08] hover:text-error"
      >
        ×
      </button>
    </div>
  );
}
