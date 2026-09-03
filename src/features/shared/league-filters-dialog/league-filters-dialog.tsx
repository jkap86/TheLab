"use client";

import { useMemo, useRef, useState } from "react";

import type { ManagerLeague } from "@/shared/contract";
import {
  activeFilterCount,
  BEST_BALL_OPTIONS,
  DEFAULT_LEAGUE_FILTERS,
  type LeagueFilters,
  matchesFilters,
  matchesScoringRule,
  matchesSettingRule,
  matchesSlotRule,
  scoringKeyLabel,
  scoringKeyOptions,
  SETTING_KEY_BY_KEY,
  settingKeyLabel,
  settingKeyOptions,
  SLOT_GROUPS,
  TEAMS_KEY,
  TYPE_OPTIONS,
} from "../league-filters";

import { CONSOLE_KEY_BLOCK, CONSOLE_KEY_PILL, CONSOLE_WELL } from "../console-chrome";
import { FilterRail } from "./filter-rail";
import {
  SCORING_PRESETS,
  SETTING_PRESETS,
  SLOT_PRESETS,
} from "./league-filters-presets";
import { MatchRail } from "./match-rail";
import { RuleBay } from "./rule-bay";

/**
 * The league filters: two fixed rails over what a league *is*, three lists of
 * rules over how it is set up, what it starts and what it pays, and a live
 * readout of what is left.
 *
 * **It edits a draft and commits on Apply**, which is the one place it diverges
 * from `LineupColumnsDialog` — and deliberately. Every count in here (per
 * option, per rule, and the rail's total) is only readable if the population
 * behind it is not moving while you read it, and a rule's number field
 * re-filters on every keystroke. The columns dialog writes live because the
 * cards behind it *are* the preview; here the numbers in the dialog are.
 *
 * The dialog itself is the native element, for the reason the columns picker
 * is: `showModal()` brings the focus trap, the Esc-to-close and the
 * `::backdrop` with it, and no dependency.
 */
export function LeagueFiltersDialog({
  filters,
  onChange,
  leagues,
  triggerClassName = `${CONSOLE_KEY_PILL} inline-flex items-center`,
}: {
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  /** The unfiltered list — what every count in here is taken over. */
  leagues: readonly ManagerLeague[];
  /**
   * The trigger's *shape*, because its two call sites do not share one: the
   * trades board stands it in a row of pill keys, and the manager page stacks
   * it in the View housing as a slab. Its two *states* stay here — lit when
   * something is filtering, unlit when nothing is — since only this component
   * knows which is true.
   */
  triggerClassName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(filters);
  const active = activeFilterCount(filters);

  // Seeded on open rather than synced: a draft that tracked `filters` would
  // discard an edit the moment anything upstream re-rendered the page, and the
  // leagues stream re-renders it twice on a refresh.
  const open = () => {
    setDraft(filters);
    ref.current?.showModal();
  };
  const apply = () => {
    onChange(draft);
    ref.current?.close();
  };

  // The three menus are read off the leagues in hand — see `settingKeyOptions`.
  const settingKeys = useMemo(
    () =>
      settingKeyOptions(leagues).map((key) => ({
        value: key,
        label: settingKeyLabel(key),
        hint: SETTING_KEY_BY_KEY.get(key)?.hint,
      })),
    [leagues],
  );
  const scoringKeys = useMemo(
    () =>
      scoringKeyOptions(leagues).map((key) => ({
        value: key,
        label: scoringKeyLabel(key),
      })),
    [leagues],
  );
  const slotKeys = useMemo(
    () =>
      SLOT_GROUPS.map((group) => ({
        value: group.key,
        label: group.label,
        hint: group.hint,
      })),
    [],
  );

  // The survivors, not just how many: the rail breaks them down and the footer
  // counts them. One walk, so the two cannot report different totals.
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
        // Raised in both states: what "something is filtering" changes is the
        // key's border and its legend, not whether it is a key.
        className={`${triggerClassName} bg-[image:var(--key-bg)] shadow-[var(--key-shadow)] ${
          active > 0
            ? "border-active/40 text-readout"
            : "border-foreground/10 text-foreground/80 hover:text-readout"
        }`}
      >
        Filters
        {/* The badge is the count of *rails and rules* that are narrowing, not
            of leagues — the readout beside it is the leagues. */}
        {active > 0 && (
          <span className="ml-2 min-w-[1.125rem] rounded bg-active/22 px-1 text-center text-[0.625rem] font-bold tabular-nums">
            {active}
          </span>
        )}
      </button>

      <dialog
        ref={ref}
        aria-label="League filters"
        // Closing on a backdrop click: the dialog element itself is only ever
        // the click target when the click landed outside the panel.
        onClick={(e) => {
          if (e.target === e.currentTarget) ref.current?.close();
        }}
        className="m-auto max-h-[min(88vh,46rem)] w-[min(64rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-foreground/12 bg-background bg-[image:var(--panel-bg)] p-0 text-foreground shadow-[var(--panel-shadow),0_24px_60px_-34px_var(--surface-shadow)] backdrop:bg-black/60"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--panel-grain)]"
        />
        {/* The container the layout is queried against, and the flex column that
            lets the body scroll under a footer that stays put. `min-h-0` is what
            allows the scroll box to shrink below its content. */}
        <div className="@container relative flex max-h-[inherit] flex-col">
          {/* The panel had no title bar and leaned on `aria-label` alone. The
              bar is what makes it legible as an instrument rather than a sheet,
              and it gives Esc a visible home — the affordance was always there
              and nothing on screen said so. The label stays, because the bar's
              text is decoration for a screen reader that already has one. */}
          <div className="flex shrink-0 items-center gap-3 border-b border-foreground/9 px-5 py-3.5">
            <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-active">
              League filters
            </span>
            <span
              aria-hidden
              className="h-px flex-1 bg-gradient-to-r from-active/30 via-foreground/[0.06] to-transparent shadow-[0_1px_0_rgba(0,0,0,0.6)]"
            />
            <button
              type="button"
              aria-label="Close"
              onClick={() => ref.current?.close()}
              className={`${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] px-2.5 py-[0.3125rem] normal-case tracking-normal text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
            >
              Esc
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
            <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="flex min-w-0 flex-col gap-3">
                <div className={`${CONSOLE_WELL} flex flex-col gap-0.5 p-1.5`}>
                  <FilterRail
                    label="Type"
                    options={TYPE_OPTIONS}
                    value={draft.type}
                    leagues={leagues}
                    probe={(type) => ({ ...draft, type })}
                    onPick={(type) => setDraft({ ...draft, type })}
                  />
                  <FilterRail
                    label="Format"
                    options={BEST_BALL_OPTIONS}
                    value={draft.bestBall}
                    leagues={leagues}
                    probe={(bestBall) => ({ ...draft, bestBall })}
                    onPick={(bestBall) => setDraft({ ...draft, bestBall })}
                  />
                </div>

                {/* Settings leads at full width because its rows are the widest
                    — a key menu, a comparison and a sentinel key. */}
                <RuleBay
                  label="Settings"
                  empty="Any settings. Add a rule to narrow by how a league is set up."
                  rules={draft.settings}
                  onChange={(settings) => setDraft({ ...draft, settings })}
                  keyOptions={settingKeys}
                  newRule={{ key: TEAMS_KEY, op: "eq", value: 12 }}
                  presets={SETTING_PRESETS}
                  step={1}
                  leagues={leagues}
                  match={matchesSettingRule}
                />

                <div className="grid gap-3 @2xl:grid-cols-2">
                  <RuleBay
                    label="Roster slots"
                    empty="Any lineup. Add a rule to narrow by what a league starts."
                    rules={draft.slots}
                    onChange={(slots) => setDraft({ ...draft, slots })}
                    keyOptions={slotKeys}
                    newRule={{ key: "QB+SF", op: "gte", value: 2 }}
                    presets={SLOT_PRESETS}
                    step={1}
                    leagues={leagues}
                    match={matchesSlotRule}
                  />
                  <RuleBay
                    label="Scoring"
                    empty="Any scoring. Add a rule to narrow by what a league pays."
                    rules={draft.scoring}
                    onChange={(scoring) => setDraft({ ...draft, scoring })}
                    keyOptions={scoringKeys}
                    newRule={{
                      key: scoringKeys[0]?.value ?? "rec",
                      op: "eq",
                      value: 1,
                    }}
                    presets={SCORING_PRESETS}
                    // Half a point, because that is the step between the
                    // reception buckets a reader is usually reaching for.
                    step={0.5}
                    leagues={leagues}
                    match={matchesScoringRule}
                  />
                </div>
              </div>

              {/* `sticky` and `self-start` are facts about being a grid item
                  *beside* the controls, which it only is above `@4xl`. Stacked
                  below that they would pin the readout to the top of the scroll
                  box and take the controls' room with it. */}
              <div className="@4xl:sticky @4xl:top-0 @4xl:self-start">
                <MatchRail
                  matched={matched}
                  total={leagues.length}
                  filters={draft}
                  onChange={setDraft}
                />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-foreground/9 px-5 py-3.5">
            <p className="m-0 font-mono text-[0.6875rem] text-foreground/60">
              {matched.length} of {leagues.length} leagues
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraft(DEFAULT_LEAGUE_FILTERS)}
                className={`${CONSOLE_KEY_BLOCK} border-foreground/10 bg-[image:var(--key-bg)] px-4 text-[0.625rem] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
              >
                Reset
              </button>
              {/* Apply is the lit key: it is the one press that changes the
                  page behind the panel, where everything else changes only
                  the panel's own numbers. */}
              <button
                type="button"
                onClick={apply}
                className={`${CONSOLE_KEY_BLOCK} border-active/50 bg-[image:var(--key-bg)] px-5 text-[0.625rem] text-readout shadow-[var(--key-shadow),0_0_22px_-8px_var(--accent-glow)] [text-shadow:var(--readout-text-glow)]`}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
