import { useState } from "react";

import { mobileInputText } from "../../control-type.ts";
import {
  COMPARE_OPS,
  type FilterRule,
  type SettingValue,
  formatRuleValue,
  isSentinelRule,
  settingSentinel,
  settingValueOptions,
} from "../../league-filters";

import type { RuleKeyOption } from "./league-filters-modal.types.ts";
import { parseRuleValue } from "./league-filters-modal.utils.ts";

/**
 * The comparisons a rule over *named* numbers can make.
 *
 * `>` on an enum is a question with no meaning, and offering it is how a reader
 * builds a rule that reads as a sentence and narrows by an accident of the
 * coding. Two entries, taken from the one table rather than spelled again, so a
 * symbol changed there changes here.
 *
 * **What varies is which comparisons exist, never how they are drawn.** Spelling
 * these two out as "equals" and "is not" reads better in isolation and costs
 * ~90px of a row that has none to give: at the 16px every control here is held
 * to, a settings row on a phone already spends most of its width on parts that
 * cannot shrink. `Trades = Enabled` is unambiguous because the *value* is a
 * name, which is the whole of what this key kind changes.
 */
const NAMED_OPS = COMPARE_OPS.filter(
  (op) => op.value === "eq" || op.value === "ne",
);

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
 * two-column bay makes. The settings bay leads at full width, where the key menu
 * is **capped** instead — a 550px `<select>` around the word "Teams" is not a
 * row that reads as the sentence it is.
 *
 * **Where a key's numbers are names, the value is a menu and the comparison is
 * is / is not.** `disable_trades = 1` is correct and unreadable: nothing on
 * screen says which digit is which, and the chip the match rail draws from it is
 * a filter a reader cannot check. Same `FilterRule` underneath — a key, an op
 * and a number, compared with the same epsilon — so only the *rendering* moves.
 *
 * **A sentinel gets a key of its own rather than a menu entry, and that is the
 * difference between the second value kind and the third.** A label key is only
 * names, so a menu loses nothing; `trade_deadline` is a real scale with one
 * value beside it, and a menu that swallowed the weeks could only offer the ones
 * someone thought of. So the row keeps its number field and puts `No deadline`
 * next to it: lit, it *is* the value and the field stands down; unlit, it is the
 * way in. Both halves are needed, because `settingValue` reads 99 as an absence
 * the moment it stops comparing as a week — a reader who cannot press it by name
 * cannot ask about it at all.
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
  keyOptions: RuleKeyOption[];
  extraKey: string | null;
  step: number;
  /**
   * The number a rule opens on in this bay, which is what leaving a sentinel
   * returns to.
   *
   * The alternative is remembering the week that was typed before the sentinel
   * was pressed, which is a second piece of row state for a press most readers
   * make once — and 99 itself is the one number the field must not come back
   * carrying, since on this scale it does not mean a week.
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
  // comparison narrows with it — `trade_deadline ≥ 99` is a comparison a reader
  // could build and nothing could read.
  const onSentinel = isSentinelRule(rule);
  const ops = named || onSentinel ? NAMED_OPS : COMPARE_OPS;

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
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.05] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <select
        aria-label="Filter on"
        value={rule.key}
        onChange={(e) => {
          const key = e.target.value;
          // A key with named values has no reading for a number the old key was
          // comparing against, and no reading for `>` either — so changing key
          // lands on that key's first value and an equality, which is the one
          // rule it can be sure means something. The other direction is free:
          // a named value is a number like any other.
          const values = settingValueOptions(key);
          onChange(
            values
              ? { key, op: "eq", value: values[0]?.value ?? rule.value }
              : { ...rule, key },
          );
        }}
        // A floor and a ceiling, and both are load-bearing. Every other part of
        // this row is `shrink-0` — a control held to 16px has no width to give —
        // so without the floor the key menu absorbs the whole squeeze and
        // truncates to nothing before anything wraps. With it, the row wraps
        // instead, which is the geometry changing rather than the control. The
        // ceiling is the settings bay leading at full width: a 550px `<select>`
        // around the word "Teams" is not a row that reads as a sentence.
        className={`min-w-[8rem] max-w-[15rem] flex-1 truncate ${inset}`}
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

      {/*
        The rest of the row wraps as one piece. Every part of it is `shrink-0` —
        a control held to the 16px iOS-zoom floor has no width to give — so left
        loose they wrap one at a time and strand the remove key on a line of its
        own. Grouped, a narrow bay puts the key menu on the first line and the
        whole statement on the second, which is the row saying the same thing in
        two lines rather than in a different order.
      */}
      <div className="flex shrink-0 items-center gap-1.5">
        <select
          aria-label="Comparison"
          value={rule.op}
          onChange={(e) =>
            onChange({ ...rule, op: e.target.value as FilterRule["op"] })
          }
          className={`shrink-0 text-center text-active ${inset}`}
        >
          {ops.map((op) => (
            <option key={op.value} value={op.value} aria-label={op.label}>
              {op.symbol}
            </option>
          ))}
        </select>

        {named ? (
          <NamedValue
            values={named}
            value={rule.value}
            inset={inset}
            onPick={(value) => onChange({ ...rule, value })}
          />
        ) : (
          !onSentinel && (
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
              // The spinners would eat a third of a field this narrow, and the
              // step is reachable from the keyboard either way.
              className={`w-13 shrink-0 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${inset}`}
            />
          )
        )}

        {sentinel && (
          <button
            type="button"
            aria-pressed={onSentinel}
            onClick={() =>
              onChange(
                onSentinel
                  ? // Back to the scale, at the value the bay's own new rule
                    // starts on rather than at 99 — which is the one number on
                    // this field that does not mean a week.
                    { ...rule, value: fallback }
                  : { ...rule, op: "eq", value: sentinel.value },
              )
            }
            className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold ${
              onSentinel
                ? "lab-chip lab-chip-sm lab-chip-on"
                : "lab-chip lab-chip-sm text-foreground/55 hover:text-foreground"
            }`}
          >
            {sentinel.label}
          </button>
        )}

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

    </div>
  );
}

/**
 * The value half of a rule whose numbers are names.
 *
 * A rule that arrived carrying a number this key has no name for still has to be
 * drawable — a stored selection outlives the build that wrote it, and a
 * `<select>` whose value isn't among its options silently shows the first one
 * instead, which is a row quietly filtering on something other than what it
 * reads. `unlistedKey`'s rule, one field over.
 */
function NamedValue({
  values,
  value,
  inset,
  onPick,
}: {
  values: readonly SettingValue[];
  value: number;
  /** The row's own slot styling, which carries the 16px iOS-zoom floor with it. */
  inset: string;
  onPick: (value: number) => void;
}) {
  const unlisted = values.some((option) => option.value === value)
    ? null
    : value;
  return (
    <select
      aria-label="Value"
      value={String(value)}
      onChange={(e) => onPick(Number(e.target.value))}
      className={`min-w-0 shrink truncate ${inset}`}
    >
      {unlisted !== null && (
        <option value={String(unlisted)}>{formatRuleValue(unlisted)}</option>
      )}
      {values.map((option) => (
        <option key={option.value} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
