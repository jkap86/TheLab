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
 *
 * **The two menus are recessed slots and the number is lit glass**, which is
 * the one thing the console pass changed here. It is not decoration: the value
 * is what the rule is *about*, and everything else on the row selects it. A
 * reader scanning three bays for the rule that emptied their list is looking
 * for numbers, and the numbers are the only things that glow.
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

  // One string for both menus, so the row cannot drift into two heights. 16px
  // specifically: anything smaller makes iOS Safari zoom the page on focus, so
  // the visual size only steps down once there is room for it to.
  const slot =
    "min-w-0 cursor-pointer appearance-none rounded-lg bg-[image:var(--key-bg)] py-1.5 pl-2 pr-5 " +
    "font-mono text-[16px] text-foreground/88 shadow-[var(--well-shadow)] outline-none " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 @md:text-[0.6875rem]";
  /** `appearance-none` takes the native caret with it; this draws one back. */
  const caret = (
    <span
      aria-hidden
      className="pointer-events-none absolute right-2 text-[0.5rem] leading-none text-foreground/45"
    >
      ▼
    </span>
  );

  return (
    <div className="flex items-center gap-1.5">
      <span className="relative inline-flex min-w-0 max-w-56 flex-1 items-center">
        <select
          value={rule.key}
          aria-label="Measure"
          onChange={(e) => {
            // The op may not survive the new key — a named or sentinel key
            // admits only is / is not, and carrying a `≥` over would build a
            // rule the row cannot draw.
            const key = e.target.value;
            const keeps =
              settingValueOptions(key) === null
                ? true
                : rule.op === "eq" || rule.op === "ne";
            onChange({ ...rule, key, op: keeps ? rule.op : "eq" });
          }}
          className={`${slot} w-full truncate`}
        >
          {extraKey !== null && <option value={extraKey}>{extraKey}</option>}
          {keyOptions.map((option) => (
            <option key={option.value} value={option.value} title={option.hint}>
              {option.label}
            </option>
          ))}
        </select>
        {caret}
      </span>

      <span className="relative inline-flex shrink-0 items-center">
        <select
          value={rule.op}
          aria-label="Comparison"
          onChange={(e) =>
            onChange({ ...rule, op: e.target.value as FilterRule["op"] })
          }
          className={slot}
        >
          {ops.map((op) => (
            <option key={op.value} value={op.value} aria-label={op.label}>
              {op.symbol}
            </option>
          ))}
        </select>
        {caret}
      </span>

      {named ? (
        <span className="relative inline-flex shrink-0 items-center">
          <select
            value={String(rule.value)}
            aria-label="Value"
            onChange={(e) =>
              onChange({ ...rule, value: Number(e.target.value) })
            }
            className={slot}
          >
            {named.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {caret}
        </span>
      ) : (
        // Lit glass rather than a slot: this is the number, and the two menus
        // beside it only say which number it is.
        <span className="relative inline-flex w-14 shrink-0 items-center overflow-hidden rounded-lg border border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--readout-shadow)] focus-within:border-active/60">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
          />
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
            className="relative w-full min-w-0 bg-transparent px-2 py-1.5 text-right font-mono text-[16px] tabular-nums text-readout outline-none [text-shadow:var(--readout-text-glow)] disabled:opacity-40 @md:text-[0.6875rem]"
          />
        </span>
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
          className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-1.5 font-mono text-[0.6875rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
            onSentinel
              ? "border-active/45 bg-active/14 text-readout"
              : "border-foreground/12 text-foreground/55 hover:text-readout"
          }`}
        >
          {sentinel.label}
        </button>
      )}

      <span
        title="Leagues matching this rule on its own"
        className="ml-auto shrink-0 font-mono text-[0.6875rem] tabular-nums text-foreground/45"
      >
        {count}
      </span>

      <button
        type="button"
        aria-label="Remove rule"
        onClick={onRemove}
        className="shrink-0 rounded-md px-1.5 py-1 font-mono text-sm leading-none text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
      >
        ×
      </button>
    </div>
  );
}
