"use client";

import { useMemo } from "react";

import type { ManagerLeague } from "@/shared/contract";
import type { FilterRule } from "../league-filters";

import {
  CONSOLE_CHIP,
  CONSOLE_GLASS,
  CONSOLE_PART_HOUSING,
} from "../console-chrome";
import { Scanlines } from "../ui/card-plate";
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
 * **The bay is a machined part rather than a shallow tray**, which is the one
 * thing the card-columns pass changed here: it is {@link CONSOLE_PART_HOUSING},
 * the same part the columns picker's axes stand in, seated in the panel's own
 * hole. The tray it replaces was a surface, and what a surface cannot say is
 * that the three lists beside each other are three *objects* — which is what a
 * reader scanning for the bay that emptied their grid is looking for. The
 * accent label and the gradient hairline went with it: a part states its name
 * on its ledge, and the ledge's own cast is the cut.
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
  // What each rule *alone* leaves — folded once per draft rather than once per
  // render. `rules` is a slice of the draft and `match` a module function, so
  // this holds across the parent's renders while the dialog is closed, where
  // a walk over every league per rule per render was the cost being paid for
  // numbers nobody could see.
  const counts = useMemo(
    () => rules.map((rule) => leagues.filter((l) => match(l, rule)).length),
    [leagues, rules, match],
  );

  return (
    <section className={`${CONSOLE_PART_HOUSING} @container`}>
      {/* The part's header ledge, above its body in stacking order so its cast
          lands on the body rather than on the panel behind it. The ledge's
          *face* alone rather than `CONSOLE_WINDOW_LEDGE`, on
          `CONSOLE_BILLET_FACE`'s rule: that constant carries
          `--window-ledge-shadow` and a shadow list is atomic, so a second
          `shadow-[…]` beside it replaces the chamfer rather than casting under
          it — and which wins is Tailwind's emit order. */}
      <div className="relative z-[2] flex items-center gap-2.5 bg-[image:var(--window-ledge-bg)] px-[0.8125rem] py-2.5 shadow-[var(--window-ledge-shadow),0_2px_0_rgba(0,0,0,0.7),0_8px_14px_-8px_rgba(0,0,0,0.85)]">
        {/* **The rule count is a lit chip that never leaves the ledge.** It used
            to be a bare figure that appeared once a bay had a rule and was
            absent otherwise, which is the one thing a panel a reader is
            pressing into must not do — a part that changes height under the
            press that adds a rule. The chip is always there and only its lamp
            and its ink move: lit and counting, or unlit and reading `Any`,
            which is the honest name for a bay narrowing nothing. */}
        <span
          className={`${CONSOLE_GLASS} inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 ${
            rules.length > 0 ? "border-active/45" : "border-black/70"
          }`}
        >
          <Scanlines />
          <span
            aria-hidden
            className={`relative size-[0.3125rem] shrink-0 rounded-full ${
              rules.length > 0
                ? "bg-active shadow-[0_0_7px_var(--accent-glow)]"
                : "bg-black/40 shadow-[inset_0_1px_1px_rgba(0,0,0,0.6)]"
            }`}
          />
          <span
            className={`relative font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] ${
              rules.length > 0
                ? "text-readout [text-shadow:var(--readout-text-glow)]"
                : "text-readout-muted"
            }`}
          >
            {rules.length === 0
              ? "Any"
              : `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`}
          </span>
        </span>
        {/* Ink on metal, not the readout's mint: a name stamped into a machined
            face is the metal's own colour lightened, and drawing it in mint
            would say the ledge was a window. */}
        <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-16)] font-semibold tracking-[-0.005em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
          {label}
        </span>
      </div>

      <div className="relative flex flex-col gap-[0.5625rem] bg-[image:var(--key-bg)] px-3 py-[0.8125rem]">
        {rules.length === 0 && (
          // The empty state is a *reading* — what this bay is leaving — and on
          // this panel readings are on glass.
          <p
            className={`${CONSOLE_GLASS} m-0 rounded-[0.625rem] border border-black/70 px-3 py-2.5 font-mono text-[length:var(--fs-10-5)] leading-[1.45] text-pretty text-readout-label`}
          >
            <Scanlines />
            <span className="relative">{empty}</span>
          </p>
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
            count={counts[i]}
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
          // It keeps its dashed accent border, which is the one control on the
          // panel deliberately not drawn as a key: what it does is *make* one.
          // What moved is the fill — off an accent wash and onto the body's own
          // recess, so the dashes read as an outline cut in the stock the rows
          // stand on rather than as a tinted slab lying on it.
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-active/38 bg-black/30 py-1.5 font-mono text-[length:var(--fs-10)] font-bold uppercase tracking-[0.16em] text-active shadow-[var(--track-shadow)] transition-colors hover:border-active/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
        >
          <span
            aria-hidden="true"
            className="text-[length:var(--fs-14)] leading-none"
          >
            +
          </span>
          Rule
        </button>

        {/* A milled groove before the presets. They *add* rules where the rows
            above **are** rules, and the cut is the only thing on the body that
            says so. */}
        <span
          aria-hidden
          className="h-px bg-[image:var(--groove)] shadow-[0_1px_0_rgba(255,255,255,0.05)]"
        />

        <div className="flex flex-col gap-[0.3125rem]">
          {/* **Stacked above its chips at every width**, where the panel's other
              legends take a `4.875rem` column beside their track from `sm` up.
              The handoff's prose asks for that column and its own drawing does
              this, and the drawing is right: a track holds a fixed row of keys
              where this holds nine chips that wrap, so a legend beside them
              would be one word against a block three lines deep — aligned to
              the first of them and naming all three. `--billet-label` at the
              legend's own size and tracking is what keeps it the same *voice*,
              which is what the column was standing in for. */}
          <span className="font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-[color:var(--billet-label)]">
            Quick add
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
                  // Chip stock unpressed — a small raised part lying in the
                  // body — and lit *glass* once its rule is on the list, which
                  // is what the rows above are made of: pressing one turns a
                  // preset into a rule, and the chip becomes the material a
                  // rule is drawn in.
                  className={`rounded-[0.4375rem] px-[0.5625rem] py-1 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.04em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
                    already
                      ? `${CONSOLE_GLASS} cursor-default border border-active/45 text-readout [text-shadow:var(--readout-text-glow)]`
                      : `${CONSOLE_CHIP} text-[color:var(--billet-label)] hover:text-readout`
                  }`}
                >
                  {preset.label}
                  {already && <span className="sr-only"> — already added</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
