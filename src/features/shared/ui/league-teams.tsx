"use client";

import { useState } from "react";

import type { LeagueLineupEntry, LeagueTeam, LineupMetricId } from "@/shared/contract";

import { Avatar } from "../avatar";
// Relative, not through the barrel: this folder's own modules are what a
// module in it reaches for — the rule the move here brought with it.
import {
  CONSOLE_FIGURE_WELL,
  CONSOLE_PANE_TRACK,
  CONSOLE_ROW_WELL,
} from "../console-chrome";
import { ordinal } from "../format";
import { LINEUP_METRIC_IDS, LINEUP_METRIC_LABELS } from "../lineup-columns";
import { placeAmong, rankColor, sharePercentile } from "../rank-ramp";
import { slotMedians } from "../seat-compare";
import {
  type BenchReading,
  type Lens,
  LENSES,
  LINEUP_LENS_LABELS,
  LineupBreakdown,
  LineupLensKeys,
} from "./lineup-breakdown";
import { Pane, PaneGlass, PaneHead, PaneLedge } from "./pane";

/**
 * The expanded card's team browser: the league's standings on the left, and
 * whichever team is selected — the manager's by default — solved out on the
 * right, seat by seat.
 *
 * **It is two parts on a housing, not one pane of glass.** The expanded half
 * used to be a lit window holding more lit windows, which flattened the rail,
 * both panes and the pick plates into one sheet of readings. Each pane is a
 * milled part now: a **ledge** carrying its own control and its column heads,
 * and **glass** below it carrying the rows — so a reader can see at a glance
 * which half of the card a control belongs to, and the rows read as channels
 * cut into a surface rather than as lines of a table.
 *
 * **Each control sits on its own pane's ledge, and that is the comprehension
 * fix rather than a rearrangement.** `Rank by` and the Points/Capital/KTC lens
 * shared one row above *both* panes, and neither said which half it moved — a
 * reader pressing `Capital` had no way to know from the control's position
 * whether the standings column or the seat figures were about to change.
 * Sitting on the pane it governs, each one says so without a word.
 *
 * **The total readout is gone with that row.** It printed the selected roster's
 * total under the current lens, which is the same figure the standings' own
 * Total column prints on that roster's own row, four inches to the left — one
 * number, twice, and the second copy had no place to sit once the row it lived
 * on was dissolved.
 *
 * **So is the comparison apparatus**, and this is the biggest thing the pass
 * removes: the standings' `Gap` column and rank meter, and the seat rows' ghost
 * figure and two bars. All four were one feature — the reader against the
 * selected team — and with them gone the seat name collapses to a single ink,
 * because the lit/dimmed ahead-behind rule it wore has nothing left on screen
 * to decode it. `seatComparisons` still holds that arithmetic and is not
 * deleted: it is one design decision away from being wanted again, which is the
 * line the chip rail and the billet ledge were kept on.
 *
 * **What the panes now say instead is what the numbers *mean*.** A total is
 * coloured by the team's share of the league's points and a seat figure by the
 * league's median at that slot — see `sharePercentile` and `slotPercentile` for
 * why a rank ramp is the wrong input for either. The metric column is still a
 * per-card control, deliberately unpersisted like the lens beside it, and the
 * list is still sorted by it, because it is the standings behind the card's
 * "2nd" and the order and the number must agree.
 *
 * **Both panes are fixed-height columns whose glass scrolls**, which is what
 * lets the card cap its expanded half to the viewport rather than pushing a
 * hundred-league page: a ledge holds its height, the glass takes what is left,
 * and a twelve-team standings and a ten-seat roster end on the same line. The
 * roster's glass is a frame rather than a scroller — its starters scroll inside
 * it, under two pinned drawers. See `Pane` and `LineupBreakdown`.
 *
 * **The portfolio is one of those drawers rather than a block under the two
 * panes.** Standing below them it was height taken *from* them on every card,
 * open or not, once the panel had a cap to spend — see `PickRows`.
 *
 * **The panes never stack**, at any card width, and they take equal shares of
 * it. A stacked layout put the roster below twelve teams, which is exactly the
 * reading the pane exists for; truncation carries the narrow case instead. What
 * gives way on a narrow card is columns rather than layout — every row becomes
 * two lines, the name on the first and its figures on the second, which is what
 * takes a name from four characters to a readable one at 390.
 *
 * **The columns turn at `lg`**, which is measured rather than chosen: at `sm`
 * a pane is ~252px, of which the figure cells take most, so the team names
 * render as one character each and the roster's names disappear altogether.
 * The two-line rows carry every width under that, as they already do at 390,
 * and they only get roomier on the way up. The rack and the seat rows opposite
 * made the same measurement and turn on the same breakpoint.
 *
 * **It moved here from `features/manager` when the history rail became a second
 * reader** — the line `CONSOLE_KEY`, `ManagerPlate` and `draft-picks.tsx` moved
 * on. The rail draws the same browser over a *rewound* roster set priced on
 * today's boards, which is why it is one component rather than two: the past is
 * the present's table with different rosters in it, and a second table would be
 * a second set of edge rules to drift. It is also why the rail renders this
 * element itself rather than swapping it out — one element at one position keeps
 * the metric, the lens and the selected team across a scrub, where two would
 * reset all three every time a reader crossed "now".
 */

/**
 * Points read to a decimal; draft capital and KeepTradeCut are both whole-number
 * scales. The same spellings as the breakdown's own `cell`, which is what keeps
 * the column agreeing with the rows it sorts.
 */
function formatTotal(metric: LineupMetricId, value: number): string {
  if (metric === "ros_starters" || metric === "ros_bench") {
    return value.toFixed(1);
  }
  return value.toLocaleString("en-US");
}

/** Which of the three bench totals the current lens is asking for. */
const BENCH_METRIC: Record<Lens, LineupMetricId> = {
  points: "ros_bench",
  capital: "capital_bench",
  ktc: "ktc_bench",
};

export function LeagueTeams({ entry }: { entry: LeagueLineupEntry }) {
  const [metric, setMetric] = useState<LineupMetricId>("ros_starters");
  const [chosen, setChosen] = useState<number | null>(null);
  const [lens, setLens] = useState<Lens>("points");

  // Selection is resolved, not synced: a stale choice (payload refreshed under
  // an open card) falls back to the manager's team rather than an empty pane.
  const manager = entry.teams.find((t) => t.is_manager) ?? null;
  const selected =
    entry.teams.find((t) => t.roster_id === chosen) ?? manager ?? entry.teams[0];
  if (!selected) return null;

  const teams = [...entry.teams].sort(
    (a, b) => b.totals[metric] - a.totals[metric],
  );
  const totals = entry.teams.map((t) => t.totals[metric]);
  const anyNonZero = totals.some((v) => v !== 0);

  // The league's middle player at each seat, under the lens the figures are
  // read on — what each of them is coloured against. See `slotMedians`.
  const medians = slotMedians(
    entry.teams,
    selected.lineup.starters.length,
    lens,
  );

  const benchMetric = BENCH_METRIC[lens];
  const benchTotals = entry.teams.map((t) => t.totals[benchMetric]);
  const bench: BenchReading = {
    // The same all-zero rule the Total column reads by: a bench of 0.0 under a
    // lens no roster in the league has a figure for is an absent answer.
    total: benchTotals.some((v) => v !== 0)
      ? formatTotal(benchMetric, selected.totals[benchMetric])
      : "—",
    place: placeAmong(selected.totals[benchMetric], benchTotals),
  };

  return (
    // `preserve-3d` is what carries the housing's perspective down to the two
    // parts below. Perspective only projects an element's *direct* children, so
    // without it the panes' `translateZ` would compute to an identity transform
    // — no error, and no depth. It is safe here for the one reason it is not on
    // the card's summary: nothing in this subtree clips.
    //
    // **It is a column that fills whatever height it is given**, which is what
    // lets the card cap its expanded half to the viewport: `min-h-0 flex-1`
    // here and on the row below hands the panes the panel's remaining height,
    // and they scroll their own lists inside it. Without the `min-h-0` a flex
    // item refuses to go below its content, the cap has nothing to bite on, and
    // a twelve-team table pushes the page exactly as it did before.
    <div className="flex min-h-0 flex-1 flex-col pointer-fine:[transform-style:preserve-3d]">
      <div className="flex min-h-0 flex-1 items-stretch gap-1.5 sm:gap-2.5 lg:gap-3.5 pointer-fine:[transform:translateZ(7px)]">
        <Pane>
          <PaneLedge>
            {/* A labelled recess with the menu raised out of it, on the pane it
                orders. The label is the control's name, so the `<select>` needs
                none of its own — but it keeps an `sr-only` one, because a
                screen reader reaches the select without the text beside it. */}
            <label
              className={`${CONSOLE_PANE_TRACK} flex min-w-0 items-center gap-1.5 p-[3px] pl-[9px] lg:gap-2.5 lg:pl-3`}
            >
              <span
                aria-hidden
                className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] lg:text-[length:var(--fs-10)]"
              >
                {/* `Sort` on a phone, where the track is ~165px and the key
                    inside it is what a reader actually reads. */}
                <span className="lg:hidden">Sort</span>
                <span className="hidden lg:inline">Sort by</span>
              </span>
              <span className="sr-only">Order teams by</span>
              <span className="relative flex min-w-0 flex-1 items-center">
                {/* The tracking comes off on a coarse pointer, where
                    `globals.css` floors every control at 16px so iOS Safari
                    does not zoom the page on focus. Tracking is a small-type
                    affordance and it is pure width at 16: measured at 390, the
                    lens key's `Points` needs 69.1px of the 62 it has at
                    `0.12em` and reads `Point…` — a whole word truncated — and
                    60.5 of 64 at `0.03em`, which is the word. The caret gutter
                    gives the last four of those pixels. It buys the sort key
                    one character back of the two the floor costs it (8 → 7 of
                    `ROS starters`, against 6 uncompensated); that one stays
                    truncated at any tracking, which is the same reading it
                    already ships at this width. */}
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as LineupMetricId)}
                  className="min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-full bg-[image:var(--key-bg)] py-[5px] pl-[9px] pr-5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-readout shadow-[var(--key-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 pointer-coarse:pr-[18px] pointer-coarse:tracking-[0.03em] lg:py-[7px] lg:pl-[13px] lg:pr-[30px] lg:text-[length:var(--fs-12)] lg:tracking-[0.16em] lg:pointer-coarse:tracking-[0.06em]"
                >
                  {LINEUP_METRIC_IDS.map((id) => (
                    <option key={id} value={id}>
                      {LINEUP_METRIC_LABELS[id].column}
                    </option>
                  ))}
                </select>
                {/* `appearance-none` takes the native caret with it, so the key
                    gets one drawn back in the accent. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-2 text-[length:var(--fs-8)] leading-none text-active lg:right-3 lg:text-[length:var(--fs-9)]"
                >
                  ▼
                </span>
              </span>
            </label>

            {/* The column heads, in the rows' own widths. Below `lg` the pane
                is ~165px and the only head worth the line is the list's own
                name — the place and the total are labelled by their shape. */}
            <div className="mt-1.5 flex items-center gap-[9px] px-[3px] lg:mt-0 lg:px-1 lg:pb-px lg:pt-[7px]">
              <span
                aria-hidden
                className="hidden w-10 shrink-0 text-center font-mono text-[length:var(--fs-10)] tracking-[0.14em] text-[color:var(--billet-label)] lg:block"
              >
                #
              </span>
              <span aria-hidden className="hidden w-5 shrink-0 lg:block" />
              <PaneHead className="min-w-0 flex-1">Teams</PaneHead>
              <span
                aria-hidden
                className="hidden w-[78px] shrink-0 text-right font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] lg:block"
              >
                Total
              </span>
            </div>
          </PaneLedge>

          {/* This pane's glass *is* the scroller — there is nothing pinned to
              it, unlike the roster's. `overflow-x-hidden` is required: the
              row's cells are fixed widths and would otherwise produce a
              horizontal bar inside a pane that has no room for one.

              **The right gutter is the scrollbar's own 11px**, so a six-figure
              total clears the thumb — the last digit sat under it. It is a
              padding and not `scrollbar-gutter: stable`, which
              `.lab-scroll-glass` deliberately reserves nothing for: 11px off a
              165px phone pane on every card is what that decision was made
              against, and a padding is spent only where a bar can actually
              be. Four longhands rather than `p-[3px] pr-[11px]` — a shorthand
              beside a longhand of the same property is settled by Tailwind's
              emit order, the trap the console constants are split to avoid. */}
          <PaneGlass className="lab-scroll-glass overflow-y-auto overflow-x-hidden pb-[3px] pl-[3px] pr-[11px] pt-[3px]">
            <ul className="relative m-0 list-none p-0">
              {teams.map((team, i) => (
                <StandingRow
                  key={team.roster_id}
                  team={team}
                  // The place is the row's own position, so it always agrees
                  // with the order the menu above sorted by.
                  place={i + 1}
                  metric={metric}
                  // Not a rank: see `sharePercentile`. Null where nothing has
                  // been scored, which is the all-zero rule the server ranks by
                  // — and which is why the totals go to dashes with it.
                  tone={
                    anyNonZero
                      ? rankColor(sharePercentile(team.totals[metric], totals))
                      : undefined
                  }
                  shown={anyNonZero}
                  selected={team.roster_id === selected.roster_id}
                  onSelect={() => setChosen(team.roster_id)}
                />
              ))}
            </ul>
          </PaneGlass>
        </Pane>

        <Pane>
          <PaneLedge>
            <LensControl lens={lens} onChange={setLens} />
            {/* Whose roster the seats below belong to. It is the pane's own
                head rather than a comparison of two teams: the ghost column
                that needed attributing went with the bars. */}
            <div className="mt-1.5 flex items-baseline gap-[9px] px-[3px] lg:mt-0 lg:px-1 lg:pb-px lg:pt-[7px]">
              <PaneHead className="min-w-0 flex-1">{selected.name}</PaneHead>
              <span
                aria-hidden
                className="hidden shrink-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] lg:block"
              >
                Starters
              </span>
            </div>
          </PaneLedge>

          {selected.lineup.starters.length > 0 ? (
            <LineupBreakdown
              lineup={selected.lineup}
              lens={lens}
              medians={medians}
              bench={bench}
              // The portfolio is this pane's second drawer rather than a block
              // below both panes — see `PickRows` for why the capped panel is
              // what moved it, and `LineupBreakdown` for the bar it sits behind.
              picks={selected.picks}
            />
          ) : (
            // No seatable lineup (an empty or wholly unknown roster) still has
            // its name above, so the picks below aren't attributed to nobody.
            <PaneGlass className="px-2 py-3 lg:px-3">
              <p className="relative m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-foreground/60">
                No seatable lineup
              </p>
            </PaneGlass>
          )}
        </Pane>
      </div>
    </div>
  );
}

/**
 * The lens, as three keys on the roster pane's ledge — and as one menu below
 * `lg`, where three keys do not fit a ~165px pane.
 *
 * **Two elements for one value, which this app otherwise refuses**, and the two
 * facts that make it safe here are the ones `WeekStepper` is rendered twice on:
 * neither copy holds any state — the lens is the caller's and the handler is
 * the caller's, so they cannot disagree — and both gates are `display: none`,
 * which takes an element out of the accessibility tree as well as out of the
 * flow. Exactly one control exists at any width. The alternative is a control
 * that changes shape, and a `<select>` cannot become three keys.
 */
function LensControl({
  lens,
  onChange,
}: {
  lens: Lens;
  onChange: (lens: Lens) => void;
}) {
  return (
    <>
      <label
        className={`${CONSOLE_PANE_TRACK} flex min-w-0 items-center gap-1.5 p-[3px] pl-[9px] lg:hidden`}
      >
        <span
          aria-hidden
          className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-[color:var(--billet-label)]"
        >
          Value
        </span>
        <span className="sr-only">Value lens</span>
        <span className="relative flex min-w-0 flex-1 items-center">
          {/* Tracking off on a coarse pointer, where the 16px control floor
              applies — see the sort key above for the measurement. */}
          <select
            value={lens}
            onChange={(e) => onChange(e.target.value as Lens)}
            className="min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-full bg-[image:var(--key-bg)] py-[5px] pl-[9px] pr-5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 pointer-coarse:pr-[18px] pointer-coarse:tracking-[0.03em]"
          >
            {LENSES.map((option) => (
              <option key={option} value={option}>
                {LINEUP_LENS_LABELS[option].key}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute right-2 text-[length:var(--fs-8)] leading-none text-active"
          >
            ▼
          </span>
        </span>
      </label>

      <div
        className={`${CONSOLE_PANE_TRACK} hidden min-w-0 items-center gap-2 p-[3px] pl-3 lg:flex`}
      >
        <span
          aria-hidden
          className="shrink-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)]"
        >
          Value in
        </span>
        <LineupLensKeys lens={lens} onChange={onChange} className="min-w-0 flex-1" />
      </div>
    </>
  );
}

/**
 * One team in the standings, as a channel cut into the pane's glass.
 *
 * **Two states are drawn as overlays rather than as fills**, and that is what
 * keeps the row reading as a cut. A selected row takes a wash of accent *and a
 * deeper shadow* — a plain background would flood the channel and the row would
 * flatten — and the manager's own row is marked by a lit edge down its left
 * side, which is the same stock the history rail's fill is drawn from rather
 * than a second green for "this is yours".
 *
 * The colour on the total is the team's **share of the league's points**, not
 * its rank: see `sharePercentile` for why a table where twelve teams sit within
 * a point of each other should not read as a blowout.
 */
function StandingRow({
  team,
  place,
  metric,
  tone,
  shown,
  selected,
  onSelect,
}: {
  team: LeagueTeam;
  place: number;
  metric: LineupMetricId;
  /** The share ramp's colour, or undefined where there is nothing to colour. */
  tone: string | undefined;
  /** False where no roster in the league has scored on this metric. */
  shown: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        // 38px at `lg` and 52 below it, since the expanded-card pass — the two
        // heights the seat row opposite takes, because the two lists are read
        // across. The selected overlay and the manager's lit edge keep their
        // insets against the smaller radius.
        className={`${CONSOLE_ROW_WELL} relative mb-[3px] flex h-[52px] w-full flex-col justify-center gap-[5px] rounded-[7px] px-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 lg:h-[38px] lg:flex-row lg:items-center lg:gap-[9px] lg:px-2.5 ${
          selected ? "" : "hover:bg-foreground/[0.04]"
        }`}
      >
        {selected && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 inset-y-[2px] rounded-[7px] bg-[color:var(--row-well-selected-bg)] shadow-[var(--row-well-selected-shadow)]"
          />
        )}
        {team.is_manager && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-1 left-0 w-[3px] rounded-full bg-[image:var(--lit-bar-bg)] shadow-[0_0_9px_var(--accent-glow)] lg:inset-y-[5px]"
          />
        )}

        {/* One node, two layouts: the name shares its line with the mark below
            `lg` and takes the third cell of the row above it. `lg:contents`
            rather than two trees — the alternative renders every team twice and
            reads each of them twice to anything listening.

            **Every cell names its `lg` order**, the mark included: place (1),
            mark (2), name (3), total (4), which is the order the column heads
            on the ledge are laid out in. The mark used to carry no order at
            all and so sorted to 0 — ahead of the place cell, under a `#` head
            that promised the place first. */}
        <span className="relative flex w-full min-w-0 items-center gap-1.5 lg:contents">
          {/* **The letter mount, always** — `LeagueTeam` carries no avatar,
              and that is what the mark is: a lit initial is a claim about an
              image that was never fetched. `Avatar`'s fallback is exactly this
              object (a bordered `foreground/5` disc with a semibold letter at
              `foreground/40`), so it is the component rather than a hand-drawn
              copy of its own fallback. `xs` is the 20px / 18px the slimmer row
              holds, and it turns on `lg` with the row rather than with the
              pane — see `Avatar`. */}
          <span className="contents lg:order-2 lg:block lg:shrink-0">
            <Avatar url={null} name={team.name} size="xs" />
          </span>
          <span
            className={`relative min-w-0 flex-1 truncate text-[length:var(--fs-13)] lg:order-3 ${
              team.is_manager
                ? "font-semibold text-readout [text-shadow:var(--readout-text-glow)]"
                : "text-foreground/86"
            }`}
          >
            {team.name}
          </span>
        </span>

        <span className="relative flex w-full items-center justify-between gap-1.5 lg:contents">
          <span className="shrink-0 font-mono text-[length:var(--fs-11)] tabular-nums text-readout-label lg:order-1 lg:w-10 lg:overflow-hidden lg:rounded-[5px] lg:bg-[color:var(--figure-well-bg)] lg:px-1 lg:py-0.5 lg:text-center lg:text-readout-line lg:shadow-[var(--figure-well-shadow)]">
            {ordinal(place)}
          </span>
          <span
            className={`${CONSOLE_FIGURE_WELL} shrink-0 px-[5px] py-0.5 text-right font-mono text-[length:var(--fs-12)] tabular-nums lg:order-4 lg:w-[78px] lg:text-[length:var(--fs-12-5)]`}
          >
            {/* The colour rides an inner span so it tints the figure rather
                than the channel the figure sits in. */}
            <span style={tone ? { color: tone } : undefined}>
              {shown ? formatTotal(metric, team.totals[metric]) : "—"}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}
