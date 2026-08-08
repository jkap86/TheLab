"use client";

import { useMemo } from "react";

import {
  type LeagueFilters,
  matchesFilters,
  scoringKeyOptions,
  seasonOptions,
  settingKeyOptions,
} from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import type {
  ExtraSegment,
  LeagueFilterRow,
} from "./league-filters-modal.types.ts";
import { LeagueFiltersFooter } from "./league-filters-footer.tsx";
import { MatchRail } from "./match-rail.tsx";
import { RuleBays } from "./rule-bays.tsx";
import { SeasonBand } from "./season-band.tsx";
import { SegmentTrough } from "./segment-trough.tsx";

/**
 * The two hosts' boxes, and the only thing that varies between them.
 *
 * The rule is the seat table's everywhere else in this app (see `SEATS`): a seat
 * may change where a part meets its edges and nothing about what the part *says*.
 * So the sections, their order, the grid they sit in, the rail and the footer are
 * one definition — what a seat picks is the inset the host has already spent.
 *
 * `dialog` stands in its own panel and owns its whole inset. `bay` is seated in
 * the ADP drawer's floating bay, which already carries `p-2.5`, so the body adds
 * only the gap under itself and the footer **bleeds back out to the bay's edges**
 * (`-mx-2.5 -mb-2.5`, the app's usual spelling for a part that has to reach a
 * wall its parent's padding holds it off): a footer whose rule stops short of
 * both walls reads as a box drawn inside a box rather than as the panel's own
 * bottom edge.
 */
const PANEL_SEATS = {
  dialog: { body: "p-5", footer: "px-5 py-4" },
  bay: { body: "pb-3", footer: "-mx-2.5 -mb-2.5 rounded-b-xl px-2.5 py-2.5" },
} as const;

export type LeagueFiltersSeat = keyof typeof PANEL_SEATS;

/**
 * The league filters themselves: the season the rest is read against, the three
 * fixed rails, the three rule lists a reader writes, the live readout, and the
 * way to commit them.
 *
 * **It is a panel and not a dialog, which is what lets the ADP drawer draw it
 * inline.** It was the body of `LeagueFiltersModal` and nothing else, and it came
 * out the moment that board's Leagues bay wanted the same controls without the
 * modality — the drawer is already a dialog, and a second one over it would make
 * the board it is being tuned against inert. What each host keeps for itself is
 * how the panel arrives and how it leaves; everything a reader actually operates
 * is here, once.
 *
 * **The layout is container-queried, and that is the load-bearing half of the
 * move rather than a tidy-up.** The two-column grid, the sticky rail and the
 * footer's restated count were viewport breakpoints — right while there was one
 * host a laptop always drew at ~1000px, and exactly wrong inside a 32rem drawer
 * on that same laptop, where every one of them would have fired in a box less
 * than half the width they were written for. `@4xl` measures the panel, so the
 * dialog is unchanged and the bay lays out as the phone layout the dialog
 * already had.
 *
 * **The draft is the host's, and deliberately so.** The selection is edited as a
 * draft and committed on Apply — the counts beside every option and every rule
 * are only readable if the population behind them isn't moving while you read
 * them, and for the ADP board there is a second half: its board is a network
 * read keyed on what the rules resolve to, so a live commit would re-fetch it on
 * every keystroke in a rule's number field. What the two hosts do *not* share is
 * what a commit writes — the dialog emits filters and closes itself, the drawer
 * writes the rules and its own draft-kind row into one stored object — so the
 * draft sits with each of them rather than in a hook this would have to thread
 * both through.
 */
export function LeagueFiltersPanel({
  draft,
  onChange,
  leagues,
  omit,
  extra,
  extraDraft,
  onExtraChange,
  hintId,
  seat = "dialog",
  onReset,
  onApply,
}: {
  /** The selection being edited — the draft, never the applied filters. */
  draft: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  /** The unfiltered list, which the per-option counts are taken over. */
  leagues: readonly ManagerLeague[];
  /**
   * Rows the caller already answers with a control of its own — see
   * {@link LeagueFilterRow}, which is where the argument for each of them is.
   */
  omit?: readonly LeagueFilterRow[];
  /** A fourth segment row the caller owns — see {@link ExtraSegment}. */
  extra?: ExtraSegment;
  extraDraft?: string;
  onExtraChange?: (value: string) => void;
  /** The host's `aria-describedby` target, where it has one. */
  hintId?: string;
  seat?: LeagueFiltersSeat;
  onReset: () => void;
  onApply: () => void;
}) {
  // The scoring vocabulary is whatever these leagues actually pay for, so it is
  // derived from the list rather than listed — see `scoringKeyOptions`.
  const scoringKeys = useMemo(() => scoringKeyOptions(leagues), [leagues]);

  // The settings vocabulary likewise: `teams` is always offered because it is
  // not in the blob at all, and everything else has to be stored by some league
  // on screen.
  const settingKeys = useMemo(() => settingKeyOptions(leagues), [leagues]);

  // And the seasons, which is the one menu that also decides whether its own
  // control is drawn at all — fewer than two is no choice to offer.
  const seasons = useMemo(() => seasonOptions(leagues), [leagues]);

  // The survivors, not just how many: the rail breaks them down, and the footer
  // counts them. One walk, so the two can't report different totals.
  const matched = useMemo(
    () => leagues.filter((league) => matchesFilters(league, draft)),
    [leagues, draft],
  );

  return (
    // The `@container` is a bare wrapper carrying layout and no `@`-variant of
    // its own — an element is never its own query container, so a threshold set
    // on the box it is measured against is a threshold that moves as it is
    // crossed. One container for the grid *and* the footer, so the width at which
    // the rail steps beside the controls is the same width at which the footer
    // stops restating its count.
    <div className="@container flex min-h-0 flex-1 flex-col">
      {/*
        The controls scroll and the footer — where Apply is — stays put below
        them. `min-h-0` is what lets this shrink into a bounded host at all: a
        flex item's floor is its own content otherwise, so the panel would
        overrun its box with the scrollbar nowhere. `overscroll-contain` because
        the drawer's bay floats over a board that scrolls too, and a flick that
        reached the end of the rules and carried on into the list underneath
        would move the one thing the reader is trying to hold still.
      */}
      <div
        className={`lab-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain ${PANEL_SEATS[seat].body}`}
      >
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="flex min-w-0 flex-col gap-3">
            {!omit?.includes("season") && (
              <SeasonBand
                draft={draft}
                onChange={onChange}
                leagues={leagues}
                seasons={seasons}
              />
            )}

            <SegmentTrough
              draft={draft}
              onChange={onChange}
              leagues={leagues}
              omit={omit}
              extra={extra}
              extraDraft={extraDraft}
              onExtraChange={onExtraChange}
            />

            <RuleBays
              draft={draft}
              onChange={onChange}
              leagues={leagues}
              scoringKeys={scoringKeys}
              settingKeys={settingKeys}
            />
          </div>

          {/*
            The rail's seating, held out here rather than on the rail itself:
            `sticky` and `self-start` are facts about being a *grid item beside
            the controls*, which is a thing it only is above `@4xl`. Stacked
            below that they would pin a 200px readout to the top of the scroll
            box and take the controls' room with it.
          */}
          <div className="@4xl:sticky @4xl:top-0 @4xl:self-start">
            <MatchRail
              matched={matched}
              total={leagues.length}
              filters={draft}
              onChange={onChange}
            />
          </div>
        </div>
      </div>

      <LeagueFiltersFooter
        matched={matched.length}
        total={leagues.length}
        hintId={hintId}
        className={PANEL_SEATS[seat].footer}
        onReset={onReset}
        onApply={onApply}
      />
    </div>
  );
}
