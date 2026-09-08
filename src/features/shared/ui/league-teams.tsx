"use client";

import { useState } from "react";

import type {
  LeagueLineupEntry,
  LeagueTeam,
  LineupColumn,
  LineupMetricId,
  LineupSlot,
  ManagerLineupsPayload,
} from "@/shared/contract";
import { lineupColumnKey } from "@/shared/ktc/columns";

import { Avatar } from "../avatar";
// Relative, not through the barrel: this folder's own modules are what a
// module in it reaches for — the rule the move here brought with it.
import {
  CONSOLE_FIGURE_WELL,
  CONSOLE_PANE_TRACK,
  CONSOLE_ROW_WELL,
} from "../console-chrome";
import { ordinal } from "../format";
import {
  type ColumnValue,
  column as composeColumn,
  LINEUP_METRIC_LABELS,
  metricAt,
  metricAxes,
  storeTeamsColumn,
} from "../lineup-columns";
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
import { TeamsColumnDialog } from "./teams-column-dialog";

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
 * why a rank ramp is the wrong input for either. The list is still sorted by
 * the column, because it is the standings behind the card's "2nd" and the order
 * and the number must agree.
 *
 * **The column is a column now, and it is the reader's rather than the
 * sitting's.** It was a `Sort by` menu over the ten `LineupMetricId`s, held in
 * `useState` on the argument that a way of reading one card is a fact about one
 * sitting. Both halves of that changed together. Every other surface on this
 * page had stopped thinking in metric ids — the card's four bays are columns
 * composed from a value, a scope, a market, a QB board, a seat set and a
 * position set — so the table of teams was the one place a reader could not ask
 * how their leaguemates compare on the flex seat, or on the dynasty board. It
 * takes the same six axes in the same panel now (`TeamsColumnDialog`), and a
 * column composed on six axes is not something to rebuild on every visit, so it
 * is stored on the device beside the four (`useTeamsColumn`).
 *
 * **The lens beside it is that column's own value axis**, not a second control.
 * `Points` / `Capital` / `KTC` on the roster pane's ledge writes the column's
 * value straight through — one column, two places to reach it, and nothing for
 * the two to disagree about. What that costs is a scope press the reader did
 * not make: a `KTC · Picks` column pressed to `Points` has no metric at that
 * cell, so it falls back to that value's whole-roster scope. Answering nothing
 * would be a key that visibly does not work.
 *
 * **A total is read by column key, never by metric id.** `lineupColumnKey` folds
 * an un-narrowed column on each league's own board back to its bare metric, so
 * the ten totals every entry carries answer it for free, and a column that has
 * forced or narrowed reads the key the server filed its per-roster sums under.
 * An absent key is a real state — a request in flight, or a producer that could
 * not price it — and it draws the same em dash the all-zero rule does.
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
 * the selected team across a scrub, where two would reset it every time a
 * reader crossed "now". The column and its lens survive for a stronger reason
 * since they became one stored preference: they are not this element's state at
 * all.
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

/**
 * The lens a column's value axis *is*.
 *
 * **Two names for one axis, and the map exists only to say which of the two a
 * given surface speaks.** `Lens` is `points | capital | ktc` and `ColumnValue`
 * is `projection | capital | ktc`: the same three readings of a roster, differing
 * in one word because the breakdown named them for the figures it prints and
 * the picker names them for the metrics it composes. Collapsing the two types
 * would be the tidier change and the wrong one — a lens is a *display* choice
 * on a pane where a value is one axis of a stored column — so what is here is
 * the join, in one place, rather than a `value === "projection" ? …` at each
 * site that needs it.
 */
const LENS_OF_VALUE: Record<ColumnValue, Lens> = {
  projection: "points",
  capital: "capital",
  ktc: "ktc",
};

/** The same join read the other way, for a press on the lens keys. */
const VALUE_OF_LENS: Record<Lens, ColumnValue> = {
  points: "projection",
  capital: "capital",
  ktc: "ktc",
};

/**
 * What the picker is handed where the caller has nothing to hand it.
 *
 * Shared empties rather than literal defaults, so the identities are stable
 * across renders: this element is drawn inside a `memo`'d card on one of the
 * two pages that mount it, and a fresh `[]` per render is a changed prop on a
 * subtree with no reason to re-render for it. Both are real states — a page
 * whose lineups read has not landed carries no scrape stamps, and an account
 * whose leagues have no stored `roster_positions` offers no seats.
 */
const NO_KTC: ManagerLineupsPayload["ktc"] = [];
const NO_SLOTS: readonly LineupSlot[] = [];

export function LeagueTeams({
  entry,
  column,
  ktc = NO_KTC,
  slots = NO_SLOTS,
}: {
  entry: LeagueLineupEntry;
  /**
   * What the standings read and are ordered by — the device's own stored
   * column, handed down rather than read here.
   *
   * **A prop for the reason `basis` and `board` are props on the trades
   * board**: this element is mounted once per open card and the trade card that
   * also draws it is `memo`'d over hundreds of rows, so a hook subscribing
   * every instance to the same value is a subscription per card to buy nothing.
   * The *write* is a direct `storeTeamsColumn`, which is the same split
   * `LineupColumnsDialog` already makes — the value comes down, the write goes
   * to the store, and every reader moves together.
   */
  column: LineupColumn;
  /** Which markets answered and when — the picker's foot. */
  ktc?: ManagerLineupsPayload["ktc"];
  /** The starting seats this account's leagues run — the picker's slot track. */
  slots?: readonly LineupSlot[];
}) {
  const [chosen, setChosen] = useState<number | null>(null);

  // Both derived from the one stored column: see the module note on why the
  // lens is that column's value axis rather than a control of its own.
  const metric = column.metric;
  const lens = LENS_OF_VALUE[metricAxes(metric).value];
  /**
   * What a total is filed under.
   *
   * `lineupColumnKey` folds an un-narrowed column on each league's own board
   * back to its bare metric id, so the ten totals every entry carries answer it
   * without anything here knowing what the server resolved — the same property
   * the card's rank windows read their ten by.
   */
  const key = lineupColumnKey(column);
  /** This column's total for one team, or undefined where the payload has none. */
  const read = (team: LeagueTeam): number | undefined => team.totals[key];

  // Selection is resolved, not synced: a stale choice (payload refreshed under
  // an open card) falls back to the manager's team rather than an empty pane.
  const manager = entry.teams.find((t) => t.is_manager) ?? null;
  const selected =
    entry.teams.find((t) => t.roster_id === chosen) ?? manager ?? entry.teams[0];
  if (!selected) return null;

  // Absent sorts as zero, which is the only thing it can do and is why the
  // order is stable: where the payload carries no answer at all, `sort` leaves
  // the roster order the entry arrived in and the `#` place still agrees with
  // it, exactly as it does for a metric no roster has scored on.
  const teams = [...entry.teams].sort((a, b) => (read(b) ?? 0) - (read(a) ?? 0));
  // **Absent folds in with zero here and nowhere else.** The all-zero rule and
  // an unanswered column both draw an em dash and neither has anything to
  // colour, so one gate covers them; what they must not do is reach a `toFixed`
  // or a percentile, which is what `shown` is read before.
  const totals = entry.teams.map((t) => read(t) ?? 0);
  const anyNonZero = entry.teams.some((t) => {
    const value = read(t);
    return value !== undefined && value !== 0;
  });

  // The league's middle player at each seat, under the lens the figures are
  // read on — what each of them is coloured against. See `slotMedians`.
  const medians = slotMedians(
    entry.teams,
    selected.lineup.starters.length,
    lens,
  );

  /**
   * Press a lens: write that value onto the column and store it.
   *
   * **Where the pressed value has no metric at the column's own scope, it falls
   * back to that value's whole-roster one.** A `KTC · Picks` column pressed to
   * `Points` is the case — there is no projection of a draft pick — and the
   * alternatives are both worse than moving the scope: refusing is a key that
   * visibly does nothing, and greying it would put a rule on this ledge that is
   * only explicable in the panel two clicks away.
   *
   * Every other axis is carried over, which is `ColumnAxes`' own rule for a
   * press: `column()` then drops whatever the new metric cannot read, so a
   * points column cannot keep a market and a picks column cannot keep a
   * position.
   */
  const pressLens = (next: Lens) => {
    const value = VALUE_OF_LENS[next];
    const chosenMetric =
      metricAt(value, metricAxes(metric).scope) ?? metricAt(value, "all");
    if (!chosenMetric) return;
    storeTeamsColumn(
      composeColumn(
        chosenMetric,
        column.format,
        column.lineup,
        column.positions,
        column.slots,
      ),
    );
  };

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
            {/* A labelled recess with the picker's key raised out of it, on the
                pane it orders. The legend is the control's name and the key
                carries its own `sr-only` sentence, so the recess needs no
                `<label>`: what sits in it is a button that opens a dialog, not
                a form control a name has to be associated with. */}
            <div
              className={`${CONSOLE_PANE_TRACK} flex min-w-0 items-center gap-1.5 p-[3px] pl-[9px] lg:gap-2.5 lg:pl-3`}
            >
              <span
                aria-hidden
                className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] lg:text-[length:var(--fs-10)]"
              >
                {/* `Col` on a phone, where the track is ~165px and the key
                    inside it is what a reader actually reads — the rule the
                    `Sort`/`Sort by` legend this replaces already lived by. */}
                <span className="lg:hidden">Col</span>
                <span className="hidden lg:inline">Column</span>
              </span>
              <TeamsColumnDialog
                column={column}
                onChange={storeTeamsColumn}
                ktc={ktc}
                slots={slots}
              />
            </div>

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
              {/* **The unit, where this said `Total`.** A literal was honest
                  while the pane read one metric at a time and is not now: a
                  column can be draft capital on the superflex board narrowed to
                  the flex seats, and `Total` says nothing about which of those
                  the figures under it are. The unit is the same word the card's
                  own tile prints over the same number, which is what keeps the
                  strip above and the table below reading as one instrument.
                  Truncated at `lg`'s 78px cell rather than abbreviated, since
                  what it clips is the qualifier and not the noun. */}
              <span
                aria-hidden
                className="hidden w-[78px] shrink-0 truncate text-right font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] text-[color:var(--billet-label)] lg:block"
              >
                {LINEUP_METRIC_LABELS[metric].unit}
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
                  // **The column's own figure, handed down rather than looked
                  // up by metric id inside the row.** It was the second, and
                  // the sort was already the first — so a narrowed or forced
                  // column ordered the table by one number and printed
                  // another beside it, under a head naming the narrowing. Both
                  // ends read `read()` now, which is the one lookup.
                  value={read(team)}
                  // Not a rank: see `sharePercentile`. Undefined where nothing
                  // has been scored — the all-zero rule the server ranks by,
                  // which is why the totals go to dashes with it — and where
                  // this column has no answer for this team at all.
                  tone={
                    anyNonZero && read(team) !== undefined
                      ? rankColor(sharePercentile(read(team) ?? 0, totals))
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
            <LensControl lens={lens} onChange={pressLens} />
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
          <select
            value={lens}
            onChange={(e) => onChange(e.target.value as Lens)}
            className="min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-full bg-[image:var(--key-bg)] py-[5px] pl-[9px] pr-5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
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
  value,
  tone,
  shown,
  selected,
  onSelect,
}: {
  team: LeagueTeam;
  place: number;
  /** Which scale the figure is on — how many decimals it reads to, and nothing else. */
  metric: LineupMetricId;
  /**
   * This team's figure for the column on screen, or undefined where the
   * payload carries none.
   *
   * **Handed in rather than looked up here**, because the column is a key and
   * not a metric id: a narrowed or forced column is filed under a name only
   * the caller composes, and a row that looked its own figure up by metric
   * would print the whole-roster number under a narrowed head — beside a sort
   * that had used the right one.
   */
  value: number | undefined;
  /** The share ramp's colour, or undefined where there is nothing to colour. */
  tone: string | undefined;
  /** False where no roster in the league has scored on this column. */
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
              {/* Two absences, one em dash: no roster has scored on this
                  column, or this payload carries no answer for it at all. */}
              {shown && value !== undefined ? formatTotal(metric, value) : "—"}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}
