"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";

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

import {
  CONSOLE_GLASS,
  CONSOLE_KEY_PILL,
  CONSOLE_WELL,
} from "../console-chrome";
import { BilletFinish, Scanlines } from "../ui/card-plate";
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
 *
 * **`memo`'d, because it is mounted closed on pages that render once per line
 * of a leagues stream.** Its whole body — the three key menus, the survivor
 * walk, the rails' cross-tab and every rule's count — derives from `leagues`
 * and the draft, neither of which moves on a progress line; without the memo
 * each of those lines re-ran the cross-tab behind a panel nobody could see.
 * Every caller's props are identity-stable (a store read memoized on its raw
 * string, a module-level write, a memo, two constants), which is what makes the
 * default comparison enough.
 */
export const LeagueFiltersDialog = memo(function LeagueFiltersDialog({
  filters,
  onChange,
  leagues,
  triggerClassName = `${CONSOLE_KEY_PILL} inline-flex items-center`,
  triggerChrome = "bg-[image:var(--key-bg)] shadow-[var(--key-shadow)]",
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
  /**
   * The trigger's *surface*, separately from its geometry.
   *
   * A key is a raised object by default and that is what this string says. It
   * is a prop rather than part of `triggerClassName` because the two are
   * overridden for different reasons and at different times: geometry is where
   * the key sits, and chrome is what it is made of. `/manager`'s phone strip is
   * the one caller that changes it — a key standing proud among engraved
   * figures reads as dropped onto them, so there it is etched into the plate
   * instead. Overriding it *through* `triggerClassName` would not work anyway:
   * a `bg-none` appended to a string this component already spells
   * `bg-[image:…]` in is decided by Tailwind's emit order, which is the coin
   * flip `CONSOLE_KEY_PILL` exists to keep a key out of.
   */
  triggerChrome?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(filters);
  const active = activeFilterCount(filters);

  // Seeded on open rather than synced: a draft that tracked `filters` would
  // discard an edit the moment anything upstream re-rendered the page, and the
  // leagues stream re-renders it twice on a refresh.
  //
  // **It is also what makes the selection safe to persist**, which is worth
  // knowing before anyone reverses the line above. `filters` now comes from
  // `league-filters-store`, which reads the neutral selection for the hydration
  // render and the stored one after it — so the `useState` above seeds a draft
  // nobody can reach, and by the time a reader presses the key the value is the
  // real one. A draft seeded once and never re-seeded would commit that first
  // render's defaults over whatever the device had stored, and nothing on screen
  // would say so.
  const open = () => {
    setDraft(filters);
    ref.current?.showModal();
  };
  const apply = () => {
    onChange(draft);
    ref.current?.close();
  };

  // The rails' probes, stable across a render that did not move the draft.
  // `FilterRail` memoizes its cross-tab on the probe's identity, so an inline
  // arrow here was a new function per parent render and the memo never held —
  // the counts were re-walked over every league on every render while the
  // dialog was closed.
  const probeType = useCallback(
    (type: LeagueFilters["type"]) => ({ ...draft, type }),
    [draft],
  );
  const probeBestBall = useCallback(
    (bestBall: LeagueFilters["bestBall"]) => ({ ...draft, bestBall }),
    [draft],
  );

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
  // 0 of 0 is not 0%: an account with no leagues has no share to report. The
  // same reading the match rail states at length, which is why the two are one
  // arithmetic rather than two.
  const share = leagues.length > 0 ? matched.length / leagues.length : null;
  // The foot's second reading counts the *draft* where the trigger's badge
  // counts what is committed: one says what this sitting has built and the
  // other what the page behind the panel is on.
  const narrowing = activeFilterCount(draft);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        // The *state* is the key's border and its legend — what "something is
        // filtering" changes is never whether it is a key. Which surface it
        // wears is the caller's, and both states are drawn on whichever one it
        // picked; see `triggerChrome`.
        className={`${triggerClassName} ${triggerChrome} ${
          active > 0
            ? "border-active/40 text-readout"
            : "border-foreground/10 text-foreground/80 hover:text-readout"
        }`}
      >
        Filters
        {/* The badge is the count of *rails and rules* that are narrowing, not
            of leagues — the readout beside it is the leagues. */}
        {active > 0 && (
          <span className="ml-2 min-w-[1.125rem] rounded bg-active/22 px-1 text-center text-[length:var(--fs-10)] font-bold tabular-nums">
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
        // The cap is 88% of the *visual* viewport, which is the one measure
        // that sees the software keyboard: `vh` is the large viewport and
        // ignores it outright, `dvh` tracks the URL bar and not the keyboard.
        // Uncapped against it this panel stays full height behind a keyboard
        // covering half the screen, and iOS Safari — with the page behind a
        // modal inert and nothing else to scroll — pans and scales the visual
        // viewport to reveal the focused rule row instead, an offset that
        // outlives the blur. Capped, the body scroller below is a real scroll
        // target and Safari uses it. `use-visual-viewport` publishes `--vvh`.
        //
        // **The 88% multiplies the variable rather than riding the fallback**,
        // which reads like a longer spelling of `min(var(--vvh,88vh),46rem)`
        // and is not: every desktop browser has a `visualViewport`, so the
        // fallback is never taken there and that spelling would cap the panel
        // at the *whole* window — losing, on any window under ~836px, exactly
        // the margin `m-auto` spends this 12% on. Written this way the
        // unset case is `min(88vh,46rem)` to the pixel and the keyboard case
        // keeps the same proportion of what is left visible.
        // **The case is billet stock, not `--panel-bg`.** That token is the
        // page — `ConsoleGround` paints the same radial — so a dialog wearing
        // it bottoms out on the ground's own `#08090a` and the lower two thirds
        // of its edge disappear. No backdrop alpha separates two identical
        // gradients; a case that is a *part* does, and `--panel-case-shadow` is
        // that part's chamfer read at case scale over a two-stage cast. It is
        // one list because a shadow list is atomic, and the backdrop goes to
        // `/80` with it because the case is lighter than what it replaced.
        //
        // The colour under the image is a fallback nothing paints over — the
        // gradient covers the border box — and it is a *case* colour rather
        // than `--background` on purpose: if it ever showed, a flat case is a
        // worse drawing and a page-coloured one is the bug this replaced.
        className="m-auto max-h-[min(calc(var(--vvh,100vh)*0.88),46rem)] w-[min(64rem,calc(100vw-2rem))] overflow-hidden rounded-[1.75rem] bg-[#2e3f45] bg-[image:var(--panel-case-bg)] p-0 text-foreground shadow-[var(--panel-case-shadow)] backdrop:bg-black/80"
      >
        {/* The container the layout is queried against, and the flex column that
            lets the body scroll under a footer that stays put. `min-h-0` is what
            allows the scroll box to shrink below its content.

            **The finish wraps the content rather than the dialog's own box**,
            which is the call the panel grain it replaces already made: an
            `inset` overlay on a scroll container is positioned against the
            padding box at its unscrolled origin, so on a scrolled panel it
            would end at the fold. Here the case does not scroll — the well
            inside it does — but the rule is the same one and the grain and the
            raking specular are what make a pale face read as *milled* rather
            than as a flat fill, which at case scale is the difference between
            a part and a panel. */}
        <div className="@container relative flex max-h-[inherit] flex-col">
          <BilletFinish />
          {/* **The title bar is gone and the heading sits on the case itself.**
              A billet bolted to a billet says nothing — the case *is* the part
              now, so what was a band standing proud of a dark body is a heading
              stamped into the face it stands on, and the milled cut below is
              the only cut it needs.

              **The `Esc` key went with the border it stood against.** Esc still
              closes, because `showModal()` brings it; what it loses is the one
              affordance on the panel that said so, which is the trade the
              columns picker already ships. It is the one deletion here a reader
              could see, and the one to put back first if it is missed.

              **The row is one line at every width, and both halves of that are
              load-bearing.** The heading never wraps and never shrinks; the
              reading takes what is left and truncates into it. The alternative
              is a row that wraps under the press that lengthens its reading —
              and a case that grows past its own height cap while a reader is
              pressing into it, which is the one thing this panel must not do. */}
          <div className="relative flex shrink-0 items-center justify-between gap-3.5 px-5 pb-[0.8125rem] pt-4">
            {/* Ink on metal, not the readout's mint: a heading stamped into a
                machined face is the metal's own colour lightened, and drawing it
                in mint would say the case was a window. */}
            <h2 className="m-0 shrink-0 whitespace-nowrap font-display text-[length:var(--fs-15)] font-semibold uppercase tracking-[0.13em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
              League filters
            </h2>
            {/* The one thing in the header that moves under a press, which is
                why it is on glass and why it is `aria-live`. */}
            <span
              className={`${CONSOLE_GLASS} inline-flex min-w-0 items-center gap-[0.4375rem] rounded-lg border border-black/70 px-2.5 py-[0.3125rem]`}
            >
              <Scanlines />
              <span
                aria-hidden
                className="relative size-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_6px_var(--accent-glow)]"
              />
              <span
                aria-live="polite"
                className="relative truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]"
              >
                {matched.length} / {leagues.length}
                {/* The share is dropped below `sm` rather than left to the
                    truncation above: at 390 the heading takes most of the row
                    and what the ellipsis eats is exactly this clause, so a
                    reading that ends mid-percentage is a worse answer than one
                    that does not claim to give a share. The `aria-live` text is
                    whole either way, and the panel states the share twice more
                    — on the match housing's own figure and in its meter. */}
                {share !== null && (
                  <span className="hidden sm:inline">
                    {` · ${Math.round(share * 100)}%`}
                  </span>
                )}
              </span>
            </span>
          </div>

          {/* The cut under the heading: a milled line with the light catching
              its far lip, inset from both edges so it reads as a cut in the face
              rather than as a rule drawn across the panel. */}
          <span
            aria-hidden
            className="relative mx-4 block h-px shrink-0 bg-[image:linear-gradient(to_right,transparent,var(--milled-hairline),transparent)] shadow-[0_1px_0_rgba(255,255,255,0.10)]"
          />

          {/* **The well: one hole cut in the case, holding everything a reader
              touches** — `CONSOLE_PART_TRAY`'s part-and-hole distinction at case
              scale, and what says the panel is on top of the page without
              spending a shadow on saying so.

              **The 18px rule.** `mx-2` of margin plus `px-2.5` of padding is
              18px a side, which is exactly what the body's own `px-[1.125rem]`
              spent. It is not adjustable on its own: the rails' keys size to
              their labels and grow into what is left, so the tracks lose width
              one for one with this. Change either number and change the other
              to keep the sum.

              **It is the scroller**, which the body used to be, and that is what
              the pinned match housing needs — a sticky element travels in the
              nearest scrollport, and a second scroller nested in this one would
              pin it to the wrong box. Its bottom padding moves onto that
              housing's own wrapper below `@4xl`, so the part sits on the well's
              floor rather than 17px above it. */}
          <div className="lab-scroll relative mx-2 mt-3.5 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[1.25rem] bg-[color:var(--case-well-bg)] px-2.5 pb-0 pt-[0.9375rem] shadow-[var(--case-well-shadow)] @4xl:pb-[1.0625rem]">
            <p className="m-0 font-mono text-[length:var(--fs-11)] leading-[1.5] text-foreground/70">
              Two fixed rails over what a league is, then rules over how it is
              set up.
              <span className="hidden sm:inline">
                {" "}
                Apply seats the selection — everything else moves only this
                panel&rsquo;s own numbers.
              </span>
            </p>

            {/* **A flex column below `@4xl` and a grid above it**, which is what
                the pinned match housing costs. A grid item's containing block is
                its *grid area*, and in one column that area is the item's own
                box — so `sticky bottom-0` there has nowhere to travel and does
                nothing at all. A flex item's containing block is the flex
                container's content box, which spans every row above it. Above
                `@4xl` it is a grid again and the match rail is a short item in a
                tall area, which is what `self-start` has always bought it. */}
            <div className="mt-3.5 flex flex-col @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_15rem] @4xl:gap-4">
              <div className="flex min-w-0 flex-col gap-3">
                {/* **A well rather than the part tray the handoff asks for, and
                    the reason is a measurement in light mode.**
                    `CONSOLE_PART_TRAY` is a black alpha — safe where it is
                    shipped, the columns picker's bay rack, because the parts it
                    holds are opaque and cover it. What it holds here is two
                    tracks with text lying directly on them, and over a
                    near-white well a 42% black tray under a channel is a hole
                    punched through the case with near-black labels in it: the
                    unlit keys measured **1.75:1** there, against 6.3:1 for the
                    pill keys they replace. On `--key-bg` — which is what a tray
                    holding *controls* is made of, and what these rails sat on
                    before — the same keys measure 6.9:1, with dark unmoved.
                    It is also the distinction this file's own constants draw:
                    a tray holding controls is a surface, and a tray holding
                    parts is the absence of one. Two switch tracks are
                    controls. */}
                <div className={`${CONSOLE_WELL} flex flex-col gap-2 p-2`}>
                  <FilterRail
                    label="Type"
                    options={TYPE_OPTIONS}
                    value={draft.type}
                    leagues={leagues}
                    probe={probeType}
                    onPick={(type) => setDraft({ ...draft, type })}
                  />
                  <FilterRail
                    label="Format"
                    options={BEST_BALL_OPTIONS}
                    value={draft.bestBall}
                    leagues={leagues}
                    probe={probeBestBall}
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

              {/* **Pinned to the foot of the well below `@4xl`, and sticky at
                  the top of its own column above it** — the same part, two
                  positions, because what it is *beside* changes. Stacked under
                  the controls, a reading pinned to the top would take the
                  controls' room with it; pinned to the foot it takes only its
                  own ledge, and the body is a press away.

                  The wrapper carries the well's own floor colour and the
                  padding the well gave up, so the rules slide **under** a part
                  that never touches the well's rounded edge. Above `@4xl` both
                  go: there is nothing sliding under it there, and the grid's
                  own gap is the spacing. */}
              <div className="sticky bottom-0 z-[4] bg-[color:var(--case-well-bg)] pb-[1.0625rem] pt-3.5 @4xl:top-0 @4xl:bottom-auto @4xl:self-start @4xl:bg-transparent @4xl:p-0">
                <MatchRail
                  matched={matched}
                  total={leagues.length}
                  filters={draft}
                  onChange={setDraft}
                />
              </div>
            </div>
          </div>

          {/* **The foot leaves the well and stands on the case's own face.**
              What it holds is a reading and the two controls that end the
              sitting, and neither is something a reader touches on the way to
              narrowing a list. */}
          <div className="relative flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2.5 px-5 pb-4 pt-3.5">
            <p className="m-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]">
              {matched.length} of {leagues.length}
              <span className="hidden sm:inline"> leagues</span>
              {narrowing > 0 && ` · ${narrowing} narrowing`}
            </p>
            <div className="ml-auto flex shrink-0 gap-2">
              {/* Milled from the case's own stock, which is what a key that
                  undoes rather than commits is made of here. */}
              <button
                type="button"
                onClick={() => setDraft(DEFAULT_LEAGUE_FILTERS)}
                className="lab-anim inline-flex shrink-0 items-center rounded-xl border border-black/35 bg-[image:var(--key-metal)] px-5 py-2.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-name)] shadow-[var(--key-metal-shadow)] transition-[transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 motion-safe:active:translate-y-0.5"
              >
                Reset
              </button>
              {/* **Apply is the accent cap** — the app's one filled object, and
                  the rack's own rule for a control that acts on the page. It is
                  the one press in here that does: everything else moves only
                  this panel's own numbers. The shadow is composed whole in one
                  utility, since a shadow list is atomic and a cap that lost its
                  dome is its visible half. */}
              <button
                type="button"
                onClick={apply}
                className="lab-anim inline-flex shrink-0 items-center rounded-xl border border-[var(--cap-accent-border)] bg-[image:var(--cap-accent-bg)] px-[1.625rem] py-2.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[var(--cap-accent-ink)] [text-shadow:var(--cap-ink-emboss)] shadow-[var(--cap-accent-shadow)] transition-[transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 motion-safe:active:translate-y-0.5"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
});
