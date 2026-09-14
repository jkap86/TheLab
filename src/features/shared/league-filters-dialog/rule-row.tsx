"use client";

import { useState } from "react";

import { CONSOLE_CHIP, CONSOLE_FIGURE_WELL_SHELL } from "../console-chrome";
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

  // One string for both menus, so the row cannot drift into two heights. The
  // size is the design's at every width — a touch device floors it at 17px in
  // `globals.css`, which is where the reason for that lives now: it used to be
  // spelled here as a 16px base stepped down at `@md`, and a width cannot see
  // the device the zoom belongs to.
  //
  // **A recess cut in metal, where it used to be key stock.** The row stands on
  // the bay's own body now, and a raised slab on a raised body is two faces
  // catching one light: what selects a value is a hole with a name stamped in
  // it, and the one raised thing on the row is the number. `--recess-bg` rather
  // than a `bg-black/N` is that stamp's doing — see the token: the label here is
  // ink on metal, and 34% black under a near-white light-mode body takes it to
  // 3.4:1.
  const slot =
    "min-w-0 cursor-pointer appearance-none rounded-full bg-[color:var(--recess-bg)] py-1.5 pl-3 pr-[1.375rem] " +
    "font-mono text-[length:var(--fs-10)] uppercase tracking-[0.04em] text-[color:var(--billet-label)] " +
    "shadow-[var(--track-shadow)] outline-none " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";
  /** `appearance-none` takes the native caret with it; this draws one back. */
  const caret = (
    <span
      aria-hidden
      className="pointer-events-none absolute right-2.5 text-[length:var(--fs-8)] leading-none text-foreground/45"
    >
      ▼
    </span>
  );

  return (
    // **Two lines below `@md`, one above**, and the query is the *bay*'s width
    // rather than the viewport's — which is the whole reason it is a container
    // one. The Settings bay runs the panel's full width and the other two sit
    // side by side from `@2xl`, so a desktop already holds ~336px bays: at that
    // width a single flex row squeezes the measure `<select>` to ~110px, which
    // is the one control on the row whose name has to survive, and it does so
    // on a viewport no `sm:` arm would ever have caught.
    //
    // Broken, the measure takes a line of its own and everything that only
    // *qualifies* it — the comparison, the value, the sentinel, the count and
    // the remove — sits on a second. `@md:contents` is what makes that one DOM
    // rather than two: above the query the two wrappers stop generating a box
    // and their children become items of the row again, which is the trick the
    // app rack's brand row and `DrawerRow` both turn. Rendering both shapes
    // would put every rule in the tree twice.
    <div className="flex flex-col gap-1.5 @md:flex-row @md:items-center">
      <span className="relative inline-flex min-w-0 items-center @md:max-w-56 @md:flex-1">
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

      {/* The second line, and one flex item above the query. `@md:contents`
          takes its box away there, so the five controls below become items of
          the row itself and the layout is the one this row has always had. */}
      <div className="flex items-center gap-1.5 @md:contents">
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
          // beside it only say which number it is. One grade up with the panel —
          // `--glass-shadow` and a `/70` ring where it was `--readout-shadow` and
          // `/85` — because the body it now stands on is key stock rather than a
          // well, and the deeper ring read as a hole punched in it.
          <span className="relative inline-flex w-16 shrink-0 items-center overflow-hidden rounded-[0.625rem] border border-black/70 bg-[image:var(--readout-bg)] shadow-[var(--glass-shadow)] focus-within:border-active/60">
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
              className="relative w-full min-w-0 bg-transparent px-2 py-1.5 text-right font-mono text-[length:var(--fs-11)] tabular-nums text-readout outline-none [text-shadow:var(--readout-text-glow)] disabled:opacity-40"
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
            // Chip stock unpressed, as the bay's presets are — an unpressed
            // sentinel is an *offer* rather than a control in force — and a key
            // of the track's own grade once it is the value: raised, lit and
            // carrying the riser, because pressed it is what the number field
            // beside it has stood down for. The riser is composed whole in one
            // utility, since a shadow list is atomic and a second `shadow-[…]`
            // would replace the chip's chamfer rather than raising it.
            className={`shrink-0 whitespace-nowrap rounded-full px-[0.5625rem] py-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.04em] transition-[color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
              onSentinel
                ? "border border-active/50 bg-[image:var(--key-metal)] text-readout [text-shadow:var(--readout-text-glow)] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_3px_0_rgba(0,0,0,0.65),0_7px_12px_-6px_rgba(0,0,0,0.95),0_0_20px_-5px_var(--accent-glow)]"
                : `${CONSOLE_CHIP} border border-transparent text-[color:var(--billet-label)] hover:text-readout`
            }`}
          >
            {sentinel.label}
          </button>
        )}

        {/* The count moves into a figure well — the same cut every other figure
          on this console is read out of, and the thing that separates what this
          rule leaves from the controls that set it. Deeper than the standard
          one, because it is cut into key stock rather than into a billet's
          face. */}
        <span
          title="Leagues matching this rule on its own"
          className={`${CONSOLE_FIGURE_WELL_SHELL} ml-auto shrink-0 px-2 py-[0.1875rem] font-mono text-[length:var(--fs-10)] tabular-nums text-readout-label shadow-[inset_0_2px_5px_rgba(0,0,0,0.8)]`}
        >
          {count}
        </span>

        {/* 32px square below `@md`, where a finger is the input and the row has
          already given the measure a line of its own; the tighter target above
          it, where the row is one line and every control on it is a mouse's. */}
        <button
          type="button"
          aria-label="Remove rule"
          onClick={onRemove}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md font-mono text-[length:var(--fs-14)] leading-none text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 @md:size-auto @md:px-1.5 @md:py-1"
        >
          ×
        </button>
      </div>
    </div>
  );
}
