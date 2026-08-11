"use client";

import { useMemo } from "react";

// Imported directly rather than through the projections barrel, which would
// pull `pg`-backed code into the client bundle — see `slots.ts`.
import { NON_STARTING_SLOTS } from "@/shared/projections/slots";

import { PLAYER_METRICS, PLAYER_METRICS_BY_KEY } from "../../roster-metrics";
import { ColumnHeading } from "./column-heading";
import { DraftPicks } from "./draft-picks";
import { PlayerRow } from "./player-row";
import { sectionLayout } from "./roster-layout";
import type { SectionLayout } from "./roster-layout";
import type {
  LeagueOutlook,
  LeagueRosterValues,
  LeagueTeamView,
  LeagueWeekView,
  PlayerSummary,
  TeamOutlook,
} from "./types";

/** A row of the starters list: a slot and who is in it. */
type SlotRow = { slot: string; player_id: string };

/**
 * One team's full roster — starters and bench — plus its future draft picks, with
 * each player's projected points for the rest of the season.
 *
 * The starters section shows the *best* lineup available to the team, not what
 * it is currently starting (see `outlook`), and the bench follows: everyone the
 * optimal lineup doesn't seat, best available first. Neither list marks the moves
 * against the team's current lineup — a promoted starter is drawn like any other
 * starter and a sat player like any other bench player — so what the two read as
 * is one lineup rather than a diff against another one. IR and taxi players
 * aren't broken out either; they're treated as bench depth (candidates for the
 * lineup like anyone on the bench), so they simply sit in the bench list.
 *
 * The value columns beside each player are slots the reader points at a
 * player-level metric — the projected start/bench split to start with, swappable
 * to the season total or to this player's KTC and ADP value. Pressing a heading
 * on the rail above the list opens the panel's columns editor armed on that slot;
 * which metric each column shows is held above this panel, so the two sections'
 * columns line up and one pick moves the whole column. How *many* there are is
 * the selection's too — two on a season panel, one on a week's (see
 * `sectionLayout`).
 *
 * **The head is fixed and the two sections scroll under it.** This half scrolls
 * on its own (see {@link LeagueDetailPanel}), and what is above the scroll box is
 * what a scrolled roster can't do without: the rail naming the two number columns
 * — which is also what opens the editor that aims them.
 *
 * It names no team of its own. The plate that used to head it — avatar, team name
 * and record — restated the standings row that is already highlighted a few pixels
 * to the left, and on a phone it cost ~64px of a half that is ~155px wide before
 * a single player was listed. The team name lives on that row's hover instead.
 */
export function RosterDetail({
  team,
  teams,
  players,
  rosterPositions,
  outlook,
  values,
  weekView,
  columns,
  onOpenColumn,
}: {
  team: LeagueTeamView;
  /** Every team in the league, for naming the roster an acquired pick came from. */
  teams: LeagueTeamView[];
  players: Record<string, PlayerSummary>;
  rosterPositions: string[] | null;
  outlook: LeagueOutlook | null;
  /** Per-player KTC and ADP values on this league's board, for the value columns. */
  values: LeagueRosterValues;
  /** The week's numbers, or null on a panel opened on a season. */
  weekView: LeagueWeekView;
  /** The metric key each value column shows — one on a week panel, two on a season's. */
  columns: string[];
  /** Open the panel's player-columns editor armed on this column's slot. */
  onOpenColumn: (slot: number) => void;
}) {
  const teamOutlook = useMemo(
    () => outlook?.teams.find((t) => t.roster_id === team.roster_id) ?? null,
    [outlook, team.roster_id],
  );

  const teamsById = useMemo(
    () => new Map(teams.map((t) => [t.roster_id, t])),
    [teams],
  );

  // Starters are positionally aligned with the league's non-bench slots. The
  // outlook has already done that pairing (and dropped any slot it doesn't
  // recognise), so it is only redone here for a league with no projections.
  const starters: SlotRow[] = useMemo(() => {
    const lineup = teamOutlook?.optimal;
    if (lineup) {
      return lineup.map((s) => ({ slot: s.slot, player_id: s.player_id ?? "" }));
    }

    const slots = (rosterPositions ?? []).filter((p) => !NON_STARTING_SLOTS.has(p));
    return team.starters.map((id, i) => ({ slot: slots[i] ?? "FLEX", player_id: id }));
  }, [teamOutlook, rosterPositions, team.starters]);

  const bench = useMemo(() => {
    // Everyone not in the optimal starting lineup, IR and taxi included: those
    // stashes are candidates for the lineup too now, so the ones that don't make
    // it belong here rather than in sections of their own.
    const starting = new Set(starters.map((s) => s.player_id));
    const rest = team.players.filter((id) => id && !starting.has(id));

    // Best available first once there are projections to sort on: the point of
    // the bench in a lineup tool is who you might promote off it.
    if (!outlook) return rest;
    return [...rest].sort(
      (a, b) => (outlook.players[b]?.points ?? 0) - (outlook.players[a]?.points ?? 0),
    );
  }, [starters, team, outlook]);

  const horizon = outlook?.weeks.length ?? 0;

  // The value columns need something to show: a projection, or a KTC/ADP price.
  // With none of the three — a league with no scoring on file and a roster KTC and
  // ADP don't cover — the columns and their headings go, so a "start / bench"
  // label doesn't promise a breakdown that isn't there.
  // The week's numbers count as numbers, which is not a detail: a league whose
  // horizon is empty — the one a week panel is most useful for, late in a season
  // — would otherwise have its two columns gated off by a rest-of-season read
  // that has nothing left to say.
  const hasNumbers =
    horizon > 0 ||
    weekView !== null ||
    Object.keys(values.ktc).length > 0 ||
    Object.keys(values.adp).length > 0;
  const valueColumns = hasNumbers ? columns : [];
  // The selection decides the row's shape as well as its contents: a week panel
  // is one number wide and a season panel two, so the template comes off the
  // count rather than being assumed a pair.
  const lineupLayout = sectionLayout(valueColumns.length);

  return (
    // The raised half: this is the one being acted on, against the recessed
    // field of standings beside it. `.lab-plate-sm` is the panel body's own face
    // at half the thickness — two surfaces at equal thickness read as two
    // instruments that happen to be adjacent rather than as a part seated in one.
    //
    // A flex column, because this half scrolls on its own inside the card's cap
    // (see `LeagueDetailPanel`): the coverage caveat and the column rail are the
    // head it scrolls under, and only the list below them moves.
    // The inset is a step tighter at the base tier than it was: with both value
    // columns drawn at every width the row needs the 4px more than the edge
    // does. Trim the padding, never the gap.
    <div className="lab-plate lab-plate-sm flex min-h-0 flex-col rounded-lg p-1 @sm:p-1.5 @lg:p-4">
      {teamOutlook && <LineupCoverage teamOutlook={teamOutlook} />}

      <ColumnRail
        layout={lineupLayout}
        valueColumns={valueColumns}
        onOpenColumn={onOpenColumn}
      />

      {/* One scroll box over both sections rather than one each, because the
          bench is where a reader is heading when they scroll at all and a
          starters list that held its own scrollbar would put a boundary in the
          middle of one lineup. The footnote and the picks travel with it: they
          are the tail of this list, not a fixed footer over it — where the
          standings' week range is fixed because it qualifies numbers that are
          on screen the whole time.

          The bar rides in a lane of its own rather than over the last value
          column — 8px of trailing padding, half of it paid for by bleeding into
          the plate's own inset, so a row gives up 4px and not 8. See
          `.lab-scroll` for why the lane is padding and not `scrollbar-gutter`,
          and {@link ColumnRail} for the 4px it gives up to stay over the same
          column. */}
      <div className="lab-scroll -mr-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
        <RosterSection title="Starters" layout={lineupLayout}>
          {starters.map((row, i) => (
            <PlayerRow
              key={`s-${i}`}
              player={players[row.player_id]}
              playerId={row.player_id}
              slot={row.slot}
              outlook={outlook?.players[row.player_id]}
              split={teamOutlook?.weekly_split[row.player_id]}
              layout={lineupLayout}
              columns={valueColumns}
              values={values}
              weekView={weekView}
              horizon={horizon}
            />
          ))}
        </RosterSection>

        {bench.length > 0 && (
          <RosterSection title="Bench" layout={lineupLayout}>
            {bench.map((id) => (
              <PlayerRow
                key={id}
                player={players[id]}
                playerId={id}
                outlook={outlook?.players[id]}
                split={teamOutlook?.weekly_split[id]}
                layout={lineupLayout}
                columns={valueColumns}
                values={values}
                weekView={weekView}
                horizon={horizon}
              />
            ))}
          </RosterSection>
        )}

        <ValueFootnote columns={valueColumns} values={values} />

        <DraftPicks
          picks={team.picks}
          rosterId={team.roster_id}
          teamsById={teamsById}
        />
      </div>
    </div>
  );
}

/**
 * The value columns' headings, once for the whole half.
 *
 * They used to sit in each section's own heading, which drew the same two labels
 * twice — one selection, two places claiming it, since a pick in either moves
 * both — and put a control inside the box that scrolls. The second still matters
 * now that this half scrolls: a heading carried off the top takes the only thing
 * naming those columns with it, and it is the way to change one. Hoisted, it is
 * the same rail the leagues list draws above its cards, for the same reason — a
 * list-wide selection named once above the list rather than on every row.
 *
 * Laid on the sections' own grid so each label sits over the numbers it names —
 * which is why it carries the 4px the list below it gives up to its scroll lane
 * (see the scroll box, and `.lab-scroll`). The rows are inside that box and this
 * rail is not, so anything the box reserves has to be reserved here too or the
 * heading and its column disagree about where the column is.
 *
 * The name track is left empty rather than captioned: the section titles under
 * it already say what the rows are, and a second heading word stacked on the
 * first would be the duplication this just removed.
 */
function ColumnRail({
  layout,
  valueColumns,
  onOpenColumn,
}: {
  layout: SectionLayout;
  /** The value columns' metric keys — empty when the half shows no numbers. */
  valueColumns: string[];
  onOpenColumn: (slot: number) => void;
}) {
  // Nothing to name, so no rail: a league with no projections and nothing priced
  // would otherwise spend a line on empty tracks.
  if (valueColumns.length === 0) return null;

  return (
    <div
      className={`mb-1.5 grid shrink-0 ${layout.grid} items-baseline gap-x-2 pr-1`}
    >
      {/* One cell over the row's leading tracks, however many there are: the
          name alone below `@3xl`, the slot lane and the name from it. Spanning
          rather than drawing a second empty span, so the headings can't slide
          off the columns they name when the shape changes. */}
      <span className="@3xl:col-span-2" />
      {valueColumns.map((key, slot) => (
        <ColumnHeading
          key={slot}
          // Sentence case below @lg, the standings rail's rule and for its
          // reason — see the note there. Both rails switch at one tier so the
          // two halves can't read as two instruments.
          className="text-[0.6rem] normal-case tracking-normal @lg:uppercase @lg:tracking-wide"
          label={(PLAYER_METRICS_BY_KEY[key] ?? PLAYER_METRICS[0]).label}
          onOpen={() => onOpenColumn(slot)}
        />
      ))}
    </div>
  );
}

/**
 * The one thing the two lists below can't say about themselves: that they aren't
 * the whole roster, because the solver met a slot it doesn't recognise.
 *
 * Three things this head used to carry have each left for the same reason — a
 * number lives in exactly one place. The optimal total is what the standings
 * beside this panel are ranked on, and the selected row states it under whichever
 * projection column is aimed at it, with the horizon spelled out once in that
 * table's footer. The *gap* is a headline about this team rather than a note on
 * its bench, so it is a cell in the panel's readout strip, beside the two totals
 * it is the difference between. And the **moves** — `start … · sit …` — were the
 * lineup restated in prose above the lineup itself: every name in them was already
 * on a row a few pixels below, in the section that answers where it should be, so
 * what the sentence added over the two lists was a second spelling of them. The
 * rows carry no promoted/sat marking now either: this panel shows the best lineup
 * available, not a diff against the one Sleeper has seated.
 *
 * The caveat stays because nothing else on screen can raise it — a roster quietly
 * missing a slot reads as a complete lineup.
 */
function LineupCoverage({ teamOutlook }: { teamOutlook: TeamOutlook }) {
  if (teamOutlook.unknown_slots.length === 0) return null;

  return (
    // `mb-3` rather than the section below taking `mt-3`: the rail sits between
    // the two now, and this half's head has to hold its own gap since only what
    // is under it scrolls.
    <p className="mb-3 shrink-0 text-[0.7rem] text-foreground/40">
      {teamOutlook.unknown_slots.join(", ")} left out — this lineup covers only part
      of the roster.
    </p>
  );
}

/**
 * A titled group of rows, and the lane its numbers run down.
 *
 * The title names the *rows*; what names the numbers beside them is
 * {@link ColumnRail}, once for both sections, above the box this scrolls in.
 *
 * **The rows carry no rule between them and the numbers carry a lane instead.**
 * Forty hairlines down a roster is a lot of drawn furniture for a list whose
 * rows are one line each from `@3xl`, and what a reader actually needs is not a
 * boundary between rows but an edge to track the figures against. So the lane
 * is one recessed cut behind the whole section (`.lab-lane`) rather than a box
 * per row: a per-row spelling is forty sinks stacking into mud and forty radii
 * scalloping against each other at the seams, which is the arithmetic
 * `.lab-row`'s own 2px wall already answers for a dozen.
 *
 * Two things about it are load-bearing. It is drawn **before** the list and the
 * list is positioned, because an absolutely positioned element paints above
 * static siblings whatever the source order — the same rule `RowSheen` keeps one
 * tool over. And it is only drawn from `@3xl`, where the row is one line: on the
 * two-line shape the numbers are the second line only, so a full-height lane
 * would run behind the name as well and stop meaning anything.
 */
function RosterSection({
  title,
  layout,
  children,
}: {
  title: string;
  layout: SectionLayout;
  children: React.ReactNode;
}) {
  return (
    // `first:mt-0` because this is the first thing in the scroll box: the head
    // above holds its own bottom gap, so a top margin here would double it.
    // The gap grows with the shape — one-line rows are tight enough that the
    // sections need more air between them than the rows have inside them, or
    // the two lists read as one run.
    <div className="mt-3 first:mt-0 @3xl:mt-4">
      <div className={`mb-1.5 grid ${layout.grid} items-baseline gap-x-2`}>
        {/* Spans the whole row rather than sitting in the name track alone.
            There is nothing else on this line — the value columns are named
            once by the rail above, not per section — so spanning costs nothing
            and takes "Starters" out of the one track it used to truncate in.
            `col-span-full` rather than the name's own span, which is one cell
            of the one-line shape. */}
        {/* `h3`, not `h5`: the league name this panel belongs to is an `h2`, so
            a 5 here skipped two levels. The size is a class either way. */}
        <h3
          className="col-span-full min-w-0 truncate text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-foreground/45 @lg:text-xs"
        >
          {title}
        </h3>
      </div>
      <div className="relative">
        {layout.lane && (
          <span
            aria-hidden="true"
            className={`lab-lane pointer-events-none absolute inset-y-0 right-0 hidden rounded-[3px] @3xl:block ${layout.lane}`}
          />
        )}
        <ul className="relative flex flex-col">{children}</ul>
      </div>
    </div>
  );
}

/**
 * A dim line saying what the selected columns rest on — the board KTC and ADP
 * were priced against — shown only while the column it is about is selected. The
 * same "say what the number rests on" habit the standings footer and the outlook
 * caveat keep, and the reminder that KTC is a dynasty board and ADP a market
 * consensus, not points.
 *
 * Only the two board lenses need one: everything else in the catalogue is points
 * in this league's own scoring, over a horizon the standings footer beside it
 * already names.
 */
function ValueFootnote({
  columns,
  values,
}: {
  columns: string[];
  values: LeagueRosterValues;
}) {
  const showKtc = columns.includes("ktc");
  const showAdp = columns.includes("adp");
  if (!showKtc && !showAdp) return null;

  const board = values.superflex ? "superflex" : "1QB";

  return (
    <div className="mt-2 space-y-0.5 text-[0.65rem] leading-relaxed text-foreground/35">
      {showKtc && (
        <p>
          KTC · KeepTradeCut dynasty {board} value
          {values.ktc_updated_at &&
            ` · scraped ${new Date(values.ktc_updated_at).toLocaleDateString()}`}
        </p>
      )}
      {showAdp && (
        <p>
          ADP · draft-capital value off {board} {values.adp_board} drafts
          {values.adp_draft_count > 0 &&
            ` · over ${values.adp_draft_count} crawled draft${
              values.adp_draft_count === 1 ? "" : "s"
            }`}
        </p>
      )}
    </div>
  );
}
