"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  type ActiveFilter,
  BEST_BALL_OPTIONS,
  COMPARE_OPS,
  DEFAULT_LEAGUE_FILTERS,
  type FilterRule,
  type LeagueFilters,
  SLOT_GROUPS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  activeFilterCount,
  activeFilters,
  clearFilter,
  formatRuleValue,
  leagueBreakdown,
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
 * **The panel is a bay layout with a readout rail.** The three fixed segments
 * are facts about a league and compress into one trough at the top; the two rule
 * lists — what a lineup starts, what a scoring page pays — sit side by side
 * underneath as equal bays. Stacked, as they were, the rules fell below a 60vh
 * scroll box and the feature read as missing: the segments alone filled the
 * panel, so a reader who wanted "superflex leagues that pay a TE bonus" had to
 * scroll past everything they *didn't* want to find the control that asks it.
 *
 * The rail on the right is the other half of that. The match count used to be a
 * line of footer text next to Apply; it is the number the whole dialog exists to
 * move, so it is a readout with a meter, the active selection as chips that
 * strike themselves out, and a note on what the survivors actually are. It is
 * beside the controls rather than under them because it changes while you edit
 * — a number you have to scroll to is a number you check once.
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

  // The survivors, not just how many: the rail breaks them down, and the footer
  // counts them. One walk, so the two can't report different totals.
  const matched = useMemo(
    () => leagues.filter((league) => matchesFilters(league, draft)),
    [leagues, draft],
  );

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        // A raised part, because it is pressable — the app bar's grammar, in the
        // pill form `.lab-chip` carries. The cyan face is reserved for a filter
        // actually narrowing something, which is this button's one signal.
        className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-sm font-semibold ${
          active > 0 ? "lab-chip-on" : "lab-chip text-foreground/85"
        }`}
      >
        <FilterIcon dim={active === 0} />
        Filters
        {active > 0 && (
          <span className="rounded-[5px] bg-[#052029] px-1.5 py-0.5 text-[11px] font-bold leading-none text-active">
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
        className="m-auto w-[min(1040px,calc(100vw-2rem))] bg-transparent p-0 text-foreground backdrop:bg-[rgba(4,10,16,0.72)] backdrop:backdrop-blur-sm"
      >
        <div
          className="filters-dialog-panel relative overflow-hidden rounded-2xl border border-active/20 bg-gradient-to-b from-[#14242f] to-[#0a1520] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95),0_0_60px_-20px_rgba(0,255,229,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]"
          style={{ animation: "dialog-rise 0.18s cubic-bezier(0.2,0.9,0.3,1)" }}
        >
          {/*
            The panel's specular rail. The header plate and the app bar both
            catch a cyan highlight along their lit edge; without it a panel this
            large reads as a flat sheet rather than as a milled face.
          */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-active/70 to-transparent"
          />

          <div className="flex items-center gap-3 border-b border-foreground/10 bg-gradient-to-b from-foreground/[0.05] to-transparent px-5 py-4">
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
            The controls scroll and the footer — where Apply is — stays put below
            them. On a laptop nothing needs to scroll at all, which is the point
            of the two-column bay; on a phone the whole grid collapses to one
            column and this is what keeps Apply reachable.
          */}
          <div className="max-h-[min(72vh,36rem)] overflow-y-auto p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="flex min-w-0 flex-col gap-4">
                {/*
                  One trough for the three fixed segments, laid out as a
                  label-and-keys grid so all three labels sit in one column. Each
                  option is a raised key in a recessed slot — the app bar's
                  material, and the reason the selected one can simply be the
                  cyan face rather than needing a border to say so.
                */}
                <div className="lab-well grid grid-cols-1 gap-x-3 gap-y-2 rounded-xl px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                  <SegmentGroup
                    label="Status"
                    options={STATUS_OPTIONS}
                    value={draft.status}
                    leagues={leagues}
                    probe={(value) => ({ ...draft, status: value })}
                    onPick={(status) => setDraft({ ...draft, status })}
                  />
                  <SegmentGroup
                    label="Type"
                    options={TYPE_OPTIONS}
                    value={draft.type}
                    leagues={leagues}
                    probe={(value) => ({ ...draft, type: value })}
                    onPick={(type) => setDraft({ ...draft, type })}
                  />
                  <SegmentGroup
                    label="Format"
                    options={BEST_BALL_OPTIONS}
                    value={draft.bestBall}
                    leagues={leagues}
                    probe={(value) => ({ ...draft, bestBall: value })}
                    onPick={(bestBall) => setDraft({ ...draft, bestBall })}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <RuleBay
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

                  <RuleBay
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
              </div>

              <MatchRail
                matched={matched}
                total={leagues.length}
                filters={draft}
                onChange={setDraft}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-foreground/10 bg-gradient-to-b from-transparent to-black/25 px-5 py-4">
            <button
              type="button"
              onClick={() => setDraft(DEFAULT_LEAGUE_FILTERS)}
              className="rounded-lg border border-foreground/10 px-4 py-2 text-sm font-semibold text-foreground/60 transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              Reset
            </button>
            {/*
              The count lives in the rail, which is beside the controls only once
              there is room for it. Below that width the rail is stacked at the
              bottom of a scrolling panel, so the footer states the number again
              — same `matched`, so the two can't disagree.
            */}
            <span className="text-sm text-foreground/60 lg:hidden">
              <b className="font-semibold tabular-nums text-foreground">
                {matched.length}
              </b>{" "}
              of {leagues.length} match
            </span>
            <span className="hidden text-xs text-foreground/40 lg:inline">
              Every filter narrows — a league has to pass all of them.
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
 * The uppercase caption over every group, slot and readout in the panel.
 *
 * One string rather than the same six utilities retyped nine times: these are
 * the only labels in the dialog and they are the thing that would drift into
 * three sizes as sections were added.
 */
const CAPTION =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/40";

/**
 * One fixed filter's options, each labelled with how many leagues it would leave.
 *
 * The count is what makes the dialog worth the click over the old bar: it is the
 * answer to "is it worth narrowing to this" before the list moves. It's probed
 * against the rest of the *draft*, so the numbers describe the selection being
 * built rather than each filter in isolation.
 *
 * It renders a fragment of two cells rather than a box of its own, so the three
 * groups share the trough's grid and their labels line up in one column — the
 * label-above-keys stack this replaced spent a row per group on a caption. Below
 * `sm` the grid is one column and the labels *do* sit above their keys: in a
 * gutter beside three wrapped rows of chips, a centred caption floats halfway
 * down the block it names.
 */
function SegmentGroup<T extends string>({
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
    <>
      <span className={CAPTION}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option, i) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(option.value)}
              className={`inline-flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold ${
                selected
                  ? "lab-chip-on"
                  : "lab-chip text-foreground/70 hover:text-foreground"
              }`}
            >
              {option.label}
              <span
                className={`font-mono text-[10px] tabular-nums ${
                  selected ? "text-[#052029]/60" : "text-foreground/35"
                }`}
              >
                {counts[i]}
              </span>
            </button>
          );
        })}
      </div>
    </>
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
 */
function RuleBay({
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
    <section className="lab-well flex flex-col gap-3 rounded-xl p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-active/75">
          {label}
        </span>
        <span className="h-px flex-1 bg-foreground/10" />
        {rules.length > 0 && (
          <span className={CAPTION}>{rules.length}</span>
        )}
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
            extraKey={
              keyOptions.some((o) => o.value === rule.key) ? null : rule.key
            }
            count={leagues.filter((l) => match(l, rule)).length}
            onChange={(next) => replace(i, next)}
            onRemove={() => onChange(rules.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange([...rules, newRule])}
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
          const already = has(preset.rule);
          return (
            <button
              key={preset.label}
              type="button"
              disabled={already}
              onClick={() => onChange([...rules, preset.rule])}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                already
                  ? "cursor-default bg-active/[0.07] text-active/40 shadow-[inset_0_0_0_1px_rgba(0,255,229,0.18)]"
                  : "lab-chip lab-chip-sm text-foreground/60 hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </section>
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
 * — the rail states that. Per rule it is the answer to "is this the rule that
 * emptied my list", which a running total can't give once there are three of them.
 *
 * The row sits at half a bay's width, so its parts are sized rather than left to
 * flex: everything but the key menu takes exactly what its content needs, and the
 * menu takes the rest. A long scoring key truncates, which is the trade the
 * two-column bay makes.
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

  // Inset parts, laid in the bay's trough: a control you type into is a slot,
  // not a key. The dark face and the top shadow are what say so.
  const inset =
    "rounded-md border border-foreground/10 bg-[#06111b] px-1.5 py-1 text-[13px] font-bold text-foreground shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] outline-none focus-visible:border-active/60";

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
          const parsed = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(parsed)) {
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
        aria-label="Remove rule"
        onClick={onRemove}
        className="shrink-0 rounded-md border border-foreground/10 px-1.5 py-1 text-sm font-bold leading-none text-foreground/40 transition-colors hover:border-[#ff5f6d]/50 hover:text-[#ff5f6d]"
      >
        ×
      </button>
    </div>
  );
}

/**
 * The live readout: how many leagues survive the draft, what is doing the
 * narrowing, and what the survivors are.
 *
 * Three things it says that a footer count can't. The **meter** puts the number
 * against the account it came out of, so "17" reads as a fifth of the leagues
 * rather than as a bare figure. The **chips** are the selection restated outside
 * the controls that built it — which matters most for the rules, since a slot
 * rule and a scoring rule live in different bays and a reader narrowing to
 * nothing otherwise has two lists to audit; each strikes itself out in place, so
 * backing off one filter costs a click rather than a hunt. And the **breakdown**
 * answers the question the count raises — 17 of what kind — along the axes that
 * say what game a league is playing.
 *
 * It edits the same draft the controls do rather than holding state, so a chip's
 * `×` and the row it names are one selection seen twice.
 */
function MatchRail({
  matched,
  total,
  filters,
  onChange,
}: {
  matched: readonly ManagerLeague[];
  total: number;
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
}) {
  const active = activeFilters(filters);
  const breakdown = useMemo(() => leagueBreakdown(matched), [matched]);
  // A cold load has no leagues to be a share of, and 0/0 is not 0% — it is a
  // question with no answer yet, so the meter and the percentage sit it out.
  const share = total > 0 ? matched.length / total : null;

  return (
    <aside
      aria-label="Matching leagues"
      className="lab-well flex flex-col gap-4 rounded-xl p-4 lg:sticky lg:top-0 lg:self-start"
    >
      <div className="flex flex-col gap-1">
        <span className={CAPTION}>Leagues matching</span>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[2.5rem] font-bold leading-none tabular-nums text-active [text-shadow:0_0_22px_rgba(0,255,229,0.45)]">
            {matched.length}
          </span>
          <span className="text-xs text-foreground/45">
            of {total}
            {share !== null && ` · ${Math.round(share * 100)}%`}
          </span>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.7)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#00b8a4] to-active shadow-[0_0_10px_rgba(0,255,229,0.7)] transition-[width] duration-200"
          style={{ width: `${(share ?? 0) * 100}%` }}
        />
      </div>

      <Divider />

      <div className="flex flex-col gap-2">
        <span className={CAPTION}>Narrowing</span>
        {active.length === 0 ? (
          <p className="text-xs text-foreground/35">
            Nothing yet — every league is in.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {active.map((entry) => (
              <ActiveChip
                key={chipKey(entry)}
                entry={entry}
                onRemove={() => onChange(clearFilter(filters, entry))}
              />
            ))}
          </div>
        )}
      </div>

      {matched.length > 0 && (
        <>
          <Divider />
          <div className="flex flex-col gap-1.5">
            <span className={CAPTION}>Of these {matched.length}</span>
            <dl className="flex flex-col gap-1">
              {breakdown.map((row) => (
                <div
                  key={row.key}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <dt className="text-foreground/55">{row.label}</dt>
                  <dd className="font-mono tabular-nums text-foreground/90">
                    {row.count}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * A rule is addressed by position, so two identical rules need distinguishing
 * keys — which the index gives and the label doesn't.
 */
function chipKey(entry: ActiveFilter): string {
  return entry.kind === "fixed"
    ? `fixed:${entry.field}`
    : `${entry.kind}:${entry.index}`;
}

function ActiveChip({
  entry,
  onRemove,
}: {
  entry: ActiveFilter;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-active/25 bg-active/10 py-0.5 pl-2 pr-1 font-mono text-[11px] text-foreground/85">
      {entry.label}
      <button
        type="button"
        aria-label={`Stop filtering by ${entry.label}`}
        onClick={onRemove}
        className="leading-none text-foreground/45 transition-colors hover:text-[#ff5f6d]"
      >
        ×
      </button>
    </span>
  );
}

function Divider() {
  return <span aria-hidden="true" className="h-px bg-foreground/10" />;
}

function FilterIcon({ dim }: { dim: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3.5 w-3.5 ${dim ? "stroke-foreground/55" : "stroke-[#052029]"}`}
      fill="none"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M1.5 3.5h13M4 8h8M6.5 12.5h3" />
    </svg>
  );
}
