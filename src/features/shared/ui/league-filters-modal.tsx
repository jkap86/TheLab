"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import {
  BEST_BALL_OPTIONS,
  COMPARE_OPS,
  DEFAULT_LEAGUE_FILTERS,
  type FilterRule,
  type LeagueFilters,
  SLOT_GROUPS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  activeFilterCount,
  formatRuleValue,
  matchesFilters,
  matchesScoringRule,
  matchesSlotRule,
  scoringKeyLabel,
  scoringKeyOptions,
} from "../league-filters";
import type { ManagerLeague } from "@/shared/manager";

/**
 * The league filters, behind a modal.
 *
 * They used to be a second zone of the header card — two rows of segment
 * buttons, permanently on screen above every view. Moving them into a dialog
 * buys the header the space the record readout now occupies, and costs the one
 * thing an always-visible bar gave for free: knowing what's selected without
 * opening anything. That is bought back twice — the trigger wears the count of
 * active filters, and the header names the selection in words beside the
 * numbers it scopes (`filterSummary`).
 *
 * A native `<dialog>` rather than a hand-rolled overlay: the focus trap, the
 * inert background, Esc-to-close and the backdrop are all the platform's, and
 * the two behaviours it doesn't give — closing on a backdrop *click*, and
 * discarding an unapplied edit — are the handlers below.
 *
 * The selection is edited as a draft and committed on Apply, because the counts
 * beside every option and rule are only readable if the list behind the dialog
 * isn't moving while you read them.
 */
export function LeagueFiltersModal({
  filters,
  onChange,
  leagues,
}: {
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  /** The unfiltered list, which the per-option counts are taken over. */
  leagues: readonly ManagerLeague[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(filters);
  const active = activeFilterCount(filters);

  // Seeding on open rather than syncing the applied filters into the draft with
  // an effect: while the dialog is up it holds the focus and the page behind it
  // is inert, so nothing can move the selection under it — the only moment the
  // two can disagree is the moment it opens.
  const open = useCallback(() => {
    setDraft(filters);
    ref.current?.showModal();
  }, [filters]);

  const apply = useCallback(() => {
    onChange(draft);
    ref.current?.close();
  }, [draft, onChange]);

  // The scoring vocabulary is whatever these leagues actually pay for, so it is
  // derived from the list rather than listed — see `scoringKeyOptions`.
  const scoringKeys = useMemo(() => scoringKeyOptions(leagues), [leagues]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-3.5 text-sm font-semibold transition-colors ${
          active > 0
            ? "border-active/35 bg-active/10 text-foreground hover:border-active/55 hover:bg-active/15"
            : "border-foreground/10 bg-foreground/5 text-foreground/70 hover:border-foreground/25 hover:text-foreground"
        }`}
      >
        <FilterIcon dim={active === 0} />
        Filters
        {active > 0 && (
          <span className="rounded-[5px] bg-active px-1.5 py-0.5 text-[11px] font-bold leading-none text-[#04141a]">
            {active}
          </span>
        )}
      </button>

      <dialog
        ref={ref}
        aria-labelledby="league-filters-title"
        // The backdrop is the dialog's own pseudo-element, so a click that lands
        // on the dialog box itself (padding-free, panel-sized) is a click outside
        // the panel — the gesture the platform doesn't wire up for you.
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close();
        }}
        className="m-auto w-[min(560px,calc(100vw-2rem))] bg-transparent p-0 text-foreground backdrop:bg-[rgba(4,10,16,0.72)] backdrop:backdrop-blur-sm"
      >
        <div
          className="filters-dialog-panel overflow-hidden rounded-2xl border border-active/20 bg-gradient-to-b from-[#12212e] to-[#0b1621] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.06)]"
          style={{ animation: "dialog-rise 0.18s cubic-bezier(0.2,0.9,0.3,1)" }}
        >
          <div className="flex items-center gap-3 border-b border-foreground/10 px-5 py-4">
            <h2
              id="league-filters-title"
              className="text-base font-semibold tracking-tight"
            >
              Filter leagues
            </h2>
            <kbd className="ml-auto rounded-[5px] border border-foreground/10 px-1.5 py-1 font-mono text-[10px] text-foreground/40">
              Esc
            </kbd>
          </div>

          {/*
            Three groups and two rule lists don't fit a laptop's viewport, so the
            sections scroll and the footer — where the match count and Apply are —
            stays put below them. Scrolling the whole panel would put the count
            that justifies the click off screen at exactly the moment it changes.
          */}
          <div className="flex max-h-[min(60vh,30rem)] flex-col gap-5 overflow-y-auto p-5">
            <Section label="League">
              <FilterGroup
                label="Status"
                options={STATUS_OPTIONS}
                value={draft.status}
                leagues={leagues}
                probe={(value) => ({ ...draft, status: value })}
                onPick={(status) => setDraft({ ...draft, status })}
              />
              <FilterGroup
                label="Type"
                options={TYPE_OPTIONS}
                value={draft.type}
                leagues={leagues}
                probe={(value) => ({ ...draft, type: value })}
                onPick={(type) => setDraft({ ...draft, type })}
              />
              <FilterGroup
                label="Format"
                options={BEST_BALL_OPTIONS}
                value={draft.bestBall}
                leagues={leagues}
                probe={(value) => ({ ...draft, bestBall: value })}
                onPick={(bestBall) => setDraft({ ...draft, bestBall })}
              />
            </Section>

            <RuleSection
              label="Roster slots"
              empty="Any lineup. Add a rule to narrow by what a league starts."
              rules={draft.slots}
              onChange={(slots) => setDraft({ ...draft, slots })}
              keyOptions={SLOT_GROUPS.map((group) => ({
                value: group.key,
                label: group.label,
                hint: group.hint,
              }))}
              newRule={{ key: "QB+SF", op: "gte", value: 2 }}
              presets={SLOT_PRESETS}
              step={1}
              leagues={leagues}
              match={matchesSlotRule}
            />

            <RuleSection
              label="Scoring settings"
              empty="Any scoring. Add a rule to narrow by what a league pays."
              rules={draft.scoring}
              onChange={(scoring) => setDraft({ ...draft, scoring })}
              keyOptions={scoringKeys.map((key) => ({
                value: key,
                label: scoringKeyLabel(key),
              }))}
              newRule={{ key: scoringKeys[0] ?? "rec", op: "eq", value: 1 }}
              presets={SCORING_PRESETS}
              step={0.5}
              leagues={leagues}
              match={matchesScoringRule}
            />
          </div>

          <div className="flex items-center gap-3 border-t border-foreground/10 px-5 py-4">
            <button
              type="button"
              onClick={() => setDraft(DEFAULT_LEAGUE_FILTERS)}
              className="rounded-lg border border-foreground/10 px-4 py-2 text-sm font-semibold text-foreground/60 transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              Reset
            </button>
            <span className="text-sm text-foreground/60">
              <b className="font-semibold tabular-nums text-foreground">
                {leagues.filter((l) => matchesFilters(l, draft)).length}
              </b>{" "}
              leagues match
            </span>
            <button
              type="button"
              onClick={apply}
              className="ml-auto rounded-lg bg-active px-4 py-2 text-sm font-bold text-[#04141a] shadow-[0_0_24px_-6px_rgba(0,255,229,0.7)] transition-[filter] hover:brightness-110"
            >
              Apply
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * A band of related filters under one eyebrow.
 *
 * A flat stack reads as a pile of unrelated questions; the bands say what each
 * is *about* — the league itself, the lineup it starts, the points it pays —
 * which is also the axis a reader arrives with ("show me my superflex leagues"
 * is a roster question they'd otherwise scan every group for). The eyebrow
 * carries the uppercase treatment the group labels used to, so the two levels
 * stay distinguishable without a second border.
 */
function Section({
  label,
  children,
  trailing,
}: {
  label: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-active/70">
          {label}
        </span>
        <span className="h-px flex-1 bg-foreground/10" />
        {trailing}
      </div>
      {children}
    </section>
  );
}

/**
 * One fixed filter's options, each labelled with how many leagues it would leave.
 *
 * The count is what makes the dialog worth the click over the old bar: it is the
 * answer to "is it worth narrowing to this" before the list moves. It's probed
 * against the rest of the *draft*, so the numbers describe the selection being
 * built rather than each filter in isolation.
 */
function FilterGroup<T extends string>({
  label,
  options,
  value,
  leagues,
  probe,
  onPick,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  leagues: readonly ManagerLeague[];
  probe: (value: T) => LeagueFilters;
  onPick: (value: T) => void;
}) {
  const counts = useMemo(
    () =>
      options.map(
        (option) =>
          leagues.filter((league) => matchesFilters(league, probe(option.value)))
            .length,
      ),
    // `probe` closes over the draft, so it is the dependency that matters.
    [options, leagues, probe],
  );

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs font-semibold text-foreground/45">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option, i) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(option.value)}
              className={`inline-flex items-baseline gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
                selected
                  ? "border-active/45 bg-active/10 text-foreground"
                  : "border-foreground/10 bg-foreground/[0.04] text-foreground/60 hover:border-foreground/25 hover:text-foreground"
              }`}
            >
              {option.label}
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  selected ? "text-active" : "text-foreground/30"
                }`}
              >
                {counts[i]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The old superflex and IDP chips, as the rules they always were. */
const SLOT_PRESETS: { label: string; rule: FilterRule }[] = [
  { label: "Superflex", rule: { key: "QB+SF", op: "gte", value: 2 } },
  { label: "One QB", rule: { key: "QB+SF", op: "eq", value: 1 } },
  { label: "IDP", rule: { key: "IDP", op: "gt", value: 0 } },
  { label: "No IDP", rule: { key: "IDP", op: "eq", value: 0 } },
  { label: "No kicker", rule: { key: "K", op: "eq", value: 0 } },
];

/** The reception buckets and TE premium, likewise. */
const SCORING_PRESETS: { label: string; rule: FilterRule }[] = [
  { label: "PPR", rule: { key: "rec", op: "gte", value: 1 } },
  { label: "Half PPR", rule: { key: "rec", op: "eq", value: 0.5 } },
  { label: "Standard", rule: { key: "rec", op: "lt", value: 0.5 } },
  { label: "TE premium", rule: { key: "bonus_rec_te", op: "gt", value: 0 } },
];

/**
 * A list of rules the reader builds, with the button that adds one.
 *
 * The presets are the point of the shape as much as the rows are: the four fixed
 * pairs this replaced were the four questions worth one click, and they still are
 * — they just write a rule now, which the reader can then edit into the question
 * they actually have (`rec = 0.5` becomes `rec ≥ 0.4`; `qb+sf ≥ 2` becomes
 * `qb+sf = 3`). A preset already on the list is dimmed rather than hidden, so the
 * row doesn't reflow as you use it, and clicking it again is a no-op rather than
 * a duplicate rule that narrows nothing twice.
 */
function RuleSection({
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
  keyOptions: { value: string; label: string; hint?: string }[];
  /** What the add button appends — the rule most readers want first. */
  newRule: FilterRule;
  presets: { label: string; rule: FilterRule }[];
  /** 1 for slot counts, 0.5 for scoring rates. */
  step: number;
  leagues: readonly ManagerLeague[];
  match: (league: ManagerLeague, rule: FilterRule) => boolean;
}) {
  const has = (rule: FilterRule) =>
    rules.some(
      (r) => r.key === rule.key && r.op === rule.op && r.value === rule.value,
    );

  const replace = (index: number, rule: FilterRule) =>
    onChange(rules.map((r, i) => (i === index ? rule : r)));

  return (
    <Section
      label={label}
      trailing={
        <button
          type="button"
          onClick={() => onChange([...rules, newRule])}
          className="inline-flex items-center gap-1 rounded-full border border-active/35 bg-active/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-active transition-colors hover:bg-active/20"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            +
          </span>
          Rule
        </button>
      }
    >
      <div className="flex flex-col gap-2">
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
            extraKey={
              keyOptions.some((o) => o.value === rule.key) ? null : rule.key
            }
            count={leagues.filter((l) => match(l, rule)).length}
            onChange={(next) => replace(i, next)}
            onRemove={() => onChange(rules.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/30">
          Quick add
        </span>
        {presets.map((preset) => {
          const already = has(preset.rule);
          return (
            <button
              key={preset.label}
              type="button"
              disabled={already}
              onClick={() => onChange([...rules, preset.rule])}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                already
                  ? "cursor-default border-active/20 bg-active/5 text-active/40"
                  : "border-foreground/10 bg-foreground/[0.04] text-foreground/55 hover:border-foreground/25 hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

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
 * — the footer states that. Per rule it is the answer to "is this the rule that
 * emptied my list", which a running total can't give once there are three of them.
 */
function RuleRow({
  rule,
  keyOptions,
  extraKey,
  step,
  count,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  keyOptions: { value: string; label: string; hint?: string }[];
  extraKey: string | null;
  step: number;
  count: number;
  onChange: (rule: FilterRule) => void;
  onRemove: () => void;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const text = edit ?? formatRuleValue(rule.value);

  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-foreground/10 bg-foreground/[0.04] p-1.5">
      <select
        aria-label="Filter on"
        value={rule.key}
        onChange={(e) => onChange({ ...rule, key: e.target.value })}
        className="min-w-0 flex-1 truncate rounded-lg border border-foreground/10 bg-[#0b1621] px-2 py-1.5 text-sm font-semibold text-foreground outline-none focus-visible:border-active/60"
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
        className="rounded-lg border border-foreground/10 bg-[#0b1621] px-2 py-1.5 text-center text-sm font-bold text-active outline-none focus-visible:border-active/60"
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
          const parsed = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(parsed)) {
            onChange({ ...rule, value: parsed });
          }
        }}
        onBlur={() => setEdit(null)}
        className="w-16 rounded-lg border border-foreground/10 bg-[#0b1621] px-2 py-1.5 text-center text-sm font-semibold tabular-nums text-foreground outline-none focus-visible:border-active/60"
      />

      <span
        title="Leagues matching this rule on its own"
        className="w-8 shrink-0 text-center font-mono text-[11px] tabular-nums text-foreground/35"
      >
        {count}
      </span>

      <button
        type="button"
        aria-label="Remove rule"
        onClick={onRemove}
        className="rounded-lg border border-foreground/10 px-2 py-1.5 text-sm font-bold leading-none text-foreground/40 transition-colors hover:border-[#ff5f6d]/50 hover:text-[#ff5f6d]"
      >
        ×
      </button>
    </div>
  );
}

function FilterIcon({ dim }: { dim: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3.5 w-3.5 ${dim ? "stroke-foreground/40" : "stroke-active"}`}
      fill="none"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M1.5 3.5h13M4 8h8M6.5 12.5h3" />
    </svg>
  );
}
