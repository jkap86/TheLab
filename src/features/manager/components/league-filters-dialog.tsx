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
} from "@/features/shared";

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
}: {
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  /** The unfiltered list — what every count in here is taken over. */
  leagues: readonly ManagerLeague[];
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
        className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50 ${
          active > 0
            ? "border-active/40 bg-active/10 text-active"
            : "border-foreground/15 text-foreground/70 hover:bg-foreground/5"
        }`}
      >
        Filters
        {active > 0 && (
          <span className="rounded bg-active/20 px-1.5 text-xs font-bold tabular-nums">
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
        className="m-auto max-h-[min(88vh,46rem)] w-[min(64rem,calc(100vw-2rem))] rounded-2xl border border-foreground/12 bg-background p-0 text-foreground shadow-[0_24px_60px_-34px_var(--surface-shadow)] backdrop:bg-black/60"
      >
        {/* The container the layout is queried against, and the flex column that
            lets the body scroll under a footer that stays put. `min-h-0` is what
            allows the scroll box to shrink below its content. */}
        <div className="@container flex max-h-[inherit] flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
            <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-col gap-0.5 rounded-xl border border-foreground/10 bg-foreground/[0.03] p-1.5">
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

          <div className="flex items-center justify-between gap-3 border-t border-foreground/10 px-5 py-4">
            <p className="text-xs text-foreground/60">
              {matched.length} of {leagues.length} leagues
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraft(DEFAULT_LEAGUE_FILTERS)}
                className="rounded-lg border border-foreground/15 px-4 py-2 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={apply}
                className="rounded-lg border border-active/40 bg-active/10 px-5 py-2 text-sm font-medium text-active transition-colors hover:bg-active/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50"
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
