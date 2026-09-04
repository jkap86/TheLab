"use client";

import { useState } from "react";

import type { LeagueLineupEntry, LineupMetricId } from "@/shared/contract";
import {
  CONSOLE_READOUT,
  LINEUP_METRIC_IDS,
  LINEUP_METRIC_LABELS,
  ordinal,
} from "@/features/shared";

import {
  placeAmong,
  rankColor,
  rankFill,
  rankPercentile,
} from "../helpers/lineup-metrics";
import { seatComparisons } from "../helpers/seat-compare";
import { DraftPicks } from "./draft-picks";
import {
  type BenchReading,
  type Lens,
  lensUnit,
  LineupBreakdown,
  LineupLensKeys,
  lineupTotal,
} from "./lineup-breakdown";

/**
 * The expanded card's team browser: the league's standings on the left, and
 * whichever team is selected — the manager's by default — solved out on the
 * right against the manager's own roster, seat by seat.
 *
 * **Its job is the comparison.** The left pane used to be a list of names with
 * one number beside each; it is a table now — place, team, the gap to the
 * reader's own total, that total, and a meter on the rank ramp — so it answers
 * "where do I sit" rather than only "who is in this league". And the right pane
 * carries the reader's figure beside every seat with the gap between the two
 * drawn as a bar, so *picking* a team reads as a comparison rather than as a
 * different roster. Everything on screen is derived from the
 * `LeagueLineupEntry` the page already holds: no new field, no second request.
 *
 * The column's metric is a per-card control, deliberately unpersisted like the
 * lens beside it: it is a way of reading *this* league's table, not a page
 * preference. Sorting by it is the point of showing it — the list is the
 * standings behind the card's "2nd of 12", so the order and the number must
 * agree. When every team totals zero on the metric the column shows dashes,
 * the same "nothing to say" rule the server ranks null by — and the meters and
 * the ramp go with it, since a full red bar under an all-zero table would claim
 * a last place nobody finished in.
 *
 * **The panes never stack**, at any card width. A stacked layout put the
 * roster below twelve teams, which is exactly the comparison the pane exists
 * to make; truncation carries the narrow case instead. What gives way on a
 * narrow card is columns rather than layout — the Gap column here, the ghost
 * figure and its two bars in the breakdown — and every row becomes two lines,
 * the name on the first and its figures on the second, which is what takes a
 * name from four characters to a readable one at 390.
 *
 * **The columns turn at `lg`, and the control row above them at `sm`**, which
 * is two breakpoints on one component and both are measured rather than
 * chosen. Five cells beside a name want ~750px of window: at `sm` the left
 * pane is 252px, of which the four figure columns take 212 — so the team names
 * render as *one character each* and the roster's names disappear altogether,
 * which is the layout at its most confident and least true. The two-line rows
 * carry every width under that, as they already do at 390, and they only get
 * roomier on the way up. The rack made the same measurement and moved to the
 * same breakpoint for it. The control row is a different question with a
 * different answer: three controls fit one line from `sm` up, so they take it.
 *
 * Both controls sit on one row above both panes rather than inside them, and
 * that is why the **lens lives here** rather than in `LineupBreakdown`:
 * neither pane is wide enough to carry a header, so the state has to be
 * visible to the keys and to the list at once.
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
  const anyNonZero = entry.teams.some((t) => t.totals[metric] !== 0);
  const total = lineupTotal(selected.lineup, lens);

  // Null where the roster on screen *is* the reader's, which is what puts the
  // pane on the league's best instead — and what its header has to say.
  const opponent =
    manager && manager.roster_id !== selected.roster_id ? manager : null;
  const compare = seatComparisons(entry.teams, selected, manager, lens);

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
    <div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2 sm:justify-between sm:gap-3">
        {/* A labelled recess with the menu raised out of it. The label is the
            control's name, so the `<select>` needs none of its own — but it
            keeps an `sr-only` one, because a screen reader reaches the select
            without the text beside it. */}
        <label className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-foreground/8 py-1.5 pl-3 pr-1.5 shadow-[var(--track-shadow)] sm:gap-2 sm:pl-3.5">
          <span
            aria-hidden
            className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-foreground/45 sm:text-[0.625rem]"
          >
            Rank by
          </span>
          <span className="sr-only">Order teams by</span>
          <span className="relative inline-flex min-w-0 items-center">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as LineupMetricId)}
              className="min-w-0 cursor-pointer appearance-none rounded-full bg-[image:var(--key-bg)] py-1.5 pl-2.5 pr-6.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-readout shadow-[var(--key-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 sm:pl-3 sm:pr-7 sm:text-[0.6875rem] sm:tracking-[0.16em]"
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
              className="pointer-events-none absolute right-2.5 text-[0.5rem] leading-none text-active sm:right-3"
            >
              ▼
            </span>
          </span>
        </label>

        {/* Below `sm` the keys take a line of their own and the total shares
            the line above with the menu, which is the only way three controls
            fit a 330px window. The wrapper is `contents` there so those two are
            laid out by the row itself rather than nested inside a group that
            would have to wrap as one — the same trick the app rack's brand row
            turns, and the reason `order` puts them back the other way round
            once there is room for the group. */}
        <div className="contents sm:flex sm:items-center sm:gap-2.5">
          {total && (
            <span
              className={`${CONSOLE_READOUT} ml-auto inline-flex items-baseline gap-1.5 rounded-[0.5625rem] px-2.5 py-1.5 sm:order-2 sm:ml-0 sm:rounded-[0.625rem] sm:px-3.5 sm:py-[0.4375rem]`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
              />
              <span className="relative font-mono text-sm tabular-nums text-readout [text-shadow:var(--readout-text-glow)] sm:text-base">
                {total}
              </span>
              <span className="relative font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-readout/60 sm:text-[0.625rem]">
                {lensUnit(lens)}
              </span>
            </span>
          )}
          <LineupLensKeys
            lens={lens}
            onChange={setLens}
            className="w-full sm:order-1 sm:w-auto"
          />
        </div>
      </div>

      <div className="flex gap-2.5 lg:gap-4">
        <div className="w-[40%] min-w-0 shrink-0 lg:w-[42%]">
          {/* The column heads, in the rows' own widths. `#` and the two
              figure columns are the desktop's; below `sm` the pane is 132px
              and the only thing worth naming is the list itself. */}
          <div className="flex items-center gap-1.5 px-1 pb-1.5 lg:gap-2 lg:px-2.5">
            <span
              aria-hidden
              className="hidden w-6 shrink-0 font-mono text-[0.5625rem] tracking-[0.14em] text-readout-label lg:block"
            >
              #
            </span>
            <span className="min-w-0 flex-1 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-foreground/60 lg:text-[0.6875rem]">
              Teams
            </span>
            <span
              aria-hidden
              className="hidden w-[62px] shrink-0 text-right font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-readout-label lg:block"
            >
              Gap
            </span>
            <span
              aria-hidden
              className="hidden w-16 shrink-0 text-right font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-readout-label lg:block"
            >
              Total
            </span>
            <span aria-hidden className="hidden w-[30px] shrink-0 lg:block" />
          </div>
          <ul className="m-0 list-none p-0">
            {teams.map((team, i) => {
              // The place is the row's own position, so it always agrees with
              // the order the menu above sorted by.
              const place = { rank: i + 1, of: teams.length };
              const fill = anyNonZero ? rankFill(place) : 0;
              // Not `fill`: that is 0 for last *and* for nothing-to-rank, and
              // only the first of those is red. See `rankPercentile`.
              const percentile = anyNonZero ? rankPercentile(place) : null;
              const tone = rankColor(percentile);
              // The gap describes the row it is printed on — a team above the
              // reader carries a `+` — while its colour describes the reader,
              // green where they are the one ahead. The same grammar the seat
              // rows opposite read by.
              const delta =
                manager && anyNonZero
                  ? team.totals[metric] - manager.totals[metric]
                  : null;
              const gapTone =
                delta === null || delta === 0 || team.roster_id === manager?.roster_id
                  ? null
                  : rankColor(delta < 0 ? 100 : 0);

              return (
                <li key={team.roster_id}>
                  <button
                    type="button"
                    onClick={() => setChosen(team.roster_id)}
                    aria-pressed={team.roster_id === selected.roster_id}
                    className={`flex h-12 w-full flex-col justify-center gap-[3px] rounded-[0.4375rem] border-l-2 pl-1 pr-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 lg:h-[34px] lg:flex-row lg:items-center lg:gap-2 lg:rounded-lg lg:pl-2 lg:pr-2.5 ${
                      team.is_manager ? "border-active" : "border-transparent"
                    } ${
                      team.roster_id === selected.roster_id
                        ? "bg-active/9"
                        : "hover:bg-foreground/[0.04]"
                    }`}
                  >
                    {/* Full opacity on the readout colour, as everywhere it is
                        text. The manager's own team is the only one lit. */}
                    <span
                      className={`block w-full truncate text-[0.8125rem] lg:order-2 lg:min-w-0 lg:flex-1 ${
                        team.is_manager
                          ? "font-semibold text-readout"
                          : "text-foreground/80"
                      }`}
                    >
                      {team.name}
                    </span>
                    <span className="flex w-full items-center gap-1.5 lg:contents">
                      <span className="shrink-0 font-mono text-[0.625rem] tabular-nums text-readout-label lg:order-1 lg:w-6 lg:text-readout-line">
                        {ordinal(place.rank)}
                      </span>
                      <span
                        className="hidden w-[62px] shrink-0 text-right font-mono text-[0.625rem] tabular-nums text-readout/60 lg:order-3 lg:block"
                        style={gapTone ? { color: gapTone } : undefined}
                      >
                        {team.roster_id === manager?.roster_id
                          ? "you"
                          : delta === null
                            ? "—"
                            : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${formatTotal(metric, Math.abs(delta))}`}
                      </span>
                      <span
                        className="order-3 shrink-0 text-right font-mono text-[0.6875rem] tabular-nums lg:order-4 lg:w-16 lg:text-xs"
                        style={{ color: tone }}
                      >
                        {anyNonZero
                          ? formatTotal(metric, team.totals[metric])
                          : "—"}
                      </span>
                      <span
                        aria-hidden
                        className="order-2 h-[3px] flex-1 rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)] lg:order-5 lg:w-[30px] lg:flex-none"
                      >
                        <span
                          className="block h-[3px] rounded-full"
                          style={{
                            width: `${fill}%`,
                            background: tone,
                            boxShadow: `0 0 8px ${rankColor(percentile, 0.5)}`,
                          }}
                        />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0 flex-1">
          {/* Which two rosters the pane is comparing, named — the ghost column
              has no header of its own and the figures in it would otherwise be
              unattributed. */}
          <div className="flex flex-col gap-0.5 pb-1.5 lg:flex-row lg:items-baseline lg:gap-2">
            <span className="min-w-0 truncate font-mono text-[0.625rem] uppercase tracking-[0.12em] text-readout lg:text-[0.6875rem] lg:tracking-[0.14em]">
              {selected.name}
            </span>
            {/* Two names and a preposition do not fit a 188px pane on one
                line — both truncated to nothing, which is the one thing this
                header cannot do, since it is what attributes the ghost column.
                So it takes a line of its own below `sm`, the same answer every
                row in both panes gives. */}
            <span className="flex min-w-0 items-baseline gap-1 lg:contents">
              <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-readout-label lg:ml-auto">
                vs
              </span>
              <span className="min-w-0 truncate font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-foreground/60 lg:max-w-[190px] lg:shrink-0">
                {opponent ? opponent.name : "Best in league"}
              </span>
            </span>
          </div>
          {selected.lineup.starters.length > 0 ? (
            <LineupBreakdown
              lineup={selected.lineup}
              lens={lens}
              compare={compare}
              bench={bench}
            />
          ) : (
            // No seatable lineup (an empty or wholly unknown roster) still has
            // its name above, so the picks below aren't attributed to nobody.
            <p className="m-0 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
              No seatable lineup
            </p>
          )}
        </div>
      </div>

      <DraftPicks picks={selected.picks} />
    </div>
  );
}
