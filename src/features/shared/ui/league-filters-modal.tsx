"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import {
  BEST_BALL_OPTIONS,
  DEFAULT_LEAGUE_FILTERS,
  IDP_OPTIONS,
  type LeagueFilters,
  SCORING_OPTIONS,
  STATUS_OPTIONS,
  SUPERFLEX_OPTIONS,
  TE_PREMIUM_OPTIONS,
  TYPE_OPTIONS,
  activeFilterCount,
  matchesFilters,
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
 * The selection is edited as a draft and committed on Apply, because each option
 * carries the count of leagues it would leave: those counts are only readable if
 * the list behind the dialog isn't moving while you read them.
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
            Seven groups don't fit a laptop's viewport, so the sections scroll
            and the footer — where the match count and Apply are — stays put
            below them. Scrolling the whole panel would put the count that
            justifies the click off screen at exactly the moment it changes.
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

            <Section label="Roster positions">
              <FilterGroup
                label="Quarterbacks"
                options={SUPERFLEX_OPTIONS}
                value={draft.superflex}
                leagues={leagues}
                probe={(value) => ({ ...draft, superflex: value })}
                onPick={(superflex) => setDraft({ ...draft, superflex })}
              />
              <FilterGroup
                label="Defense"
                options={IDP_OPTIONS}
                value={draft.idp}
                leagues={leagues}
                probe={(value) => ({ ...draft, idp: value })}
                onPick={(idp) => setDraft({ ...draft, idp })}
              />
            </Section>

            <Section label="Scoring settings">
              <FilterGroup
                label="Receptions"
                options={SCORING_OPTIONS}
                value={draft.scoring}
                leagues={leagues}
                probe={(value) => ({ ...draft, scoring: value })}
                onPick={(scoring) => setDraft({ ...draft, scoring })}
              />
              <FilterGroup
                label="Tight ends"
                options={TE_PREMIUM_OPTIONS}
                value={draft.tePremium}
                leagues={leagues}
                probe={(value) => ({ ...draft, tePremium: value })}
                onPick={(tePremium) => setDraft({ ...draft, tePremium })}
              />
            </Section>
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
 * Seven groups in a flat stack read as seven unrelated questions; three bands
 * say what each is *about* — the league itself, the lineup it starts, the points
 * it pays — which is also the axis a reader arrives with ("show me my superflex
 * leagues" is a roster question they'd otherwise scan every group for). The
 * eyebrow carries the uppercase treatment the group labels used to, so the two
 * levels stay distinguishable without a second border.
 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-active/70">
          {label}
        </span>
        <span className="h-px flex-1 bg-foreground/10" />
      </div>
      {children}
    </section>
  );
}

/**
 * One filter's options, each labelled with how many leagues it would leave.
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
