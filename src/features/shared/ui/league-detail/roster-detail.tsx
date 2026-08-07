"use client";

import { useMemo } from "react";

// Imported directly rather than through the projections barrel, which would
// pull `pg`-backed code into the client bundle — see `slots.ts`.
import { NON_STARTING_SLOTS } from "@/shared/projections/slots";

import { PLAYER_METRICS } from "../../roster-metrics";
import { ColumnPicker, type ColumnOption } from "./column-picker";
import { DraftPicks } from "./draft-picks";
import { PlayerRow } from "./player-row";
import { NO_NUMBERS, SPLIT_LAYOUT } from "./roster-layout";
import type { SectionLayout } from "./roster-layout";
import type {
  LeagueOutlook,
  LeagueRosterValues,
  LeagueTeamView,
  PlayerSummary,
  TeamOutlook,
} from "./types";

/** The player metrics offered in every roster column's picker. */
const PLAYER_METRIC_OPTIONS: ColumnOption[] = PLAYER_METRICS.map((m) => ({
  key: m.key,
  label: m.label,
}));

/** A row of the starters list: a slot and who is in it. */
type SlotRow = { slot: string; player_id: string };

/**
 * One team's full roster — starters and bench — plus its future draft picks, with
 * each player's projected points for the rest of the season.
 *
 * The starters section shows the *best* lineup available to the team, not what
 * it is currently starting (see `outlook`), and the bench follows: a player the
 * optimal lineup starts is listed as a starter and highlighted, one it sits is
 * dimmed on the bench, so the two lists always read as one lineup. IR and taxi
 * players aren't broken out — they're treated as bench depth (candidates for the
 * lineup like anyone on the bench), so they simply sit in the bench list.
 *
 * The two value columns beside each player are slots the reader points at a
 * player-level metric — the projected start/bench split to start with, swappable
 * to the season total or to this player's KTC and ADP value from the rail above
 * the list. Which metric each shows is held above this panel so the two sections'
 * columns line up and one picker moves the whole column.
 *
 * **The head is fixed and the two sections scroll under it.** This half scrolls
 * on its own (see {@link LeagueDetailPanel}), and what is above the scroll box is
 * what a scrolled roster can't do without: the moves to make, and the rail naming
 * the two number columns — which is also the control that aims them, and which
 * could not stay inside the box in any case, since its menu overhangs the rows
 * it would be clipped by.
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
  columns,
  openPicker,
  onTogglePicker,
  onSelectColumn,
  elevated,
}: {
  team: LeagueTeamView;
  /** Every team in the league, for naming the roster an acquired pick came from. */
  teams: LeagueTeamView[];
  players: Record<string, PlayerSummary>;
  rosterPositions: string[] | null;
  outlook: LeagueOutlook | null;
  /** Per-player KTC and ADP values on this league's board, for the value columns. */
  values: LeagueRosterValues;
  /** The metric key each of the two value columns shows. */
  columns: string[];
  /** Which picker is open across the whole panel, if any. */
  openPicker: string | null;
  /** Toggle a picker by its key (the panel closes any other that was open). */
  onTogglePicker: (key: string) => void;
  /** Point value column `slot` at another metric. */
  onSelectColumn: (slot: number, key: string) => void;
  /** Lift this half's stacking order while one of its pickers overhangs the rows. */
  elevated: boolean;
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
  const hasNumbers =
    horizon > 0 ||
    Object.keys(values.ktc).length > 0 ||
    Object.keys(values.adp).length > 0;
  const lineupLayout = hasNumbers ? SPLIT_LAYOUT : NO_NUMBERS;
  const valueColumns = hasNumbers ? columns : [];

  return (
    // The raised half: this is the one being acted on, against the recessed
    // field of standings beside it. `.lab-plate-sm` is the panel body's own face
    // at half the thickness — two surfaces at equal thickness read as two
    // instruments that happen to be adjacent rather than as a part seated in one.
    //
    // A flex column, because this half scrolls on its own inside the card's cap
    // (see `LeagueDetailPanel`): the lineup summary and the column rail are the
    // head it scrolls under, and only the list below them moves.
    <div
      className={`lab-plate lab-plate-sm flex min-h-0 flex-col rounded-lg p-1.5 @lg:p-4 ${
        elevated ? "relative z-30" : ""
      }`}
    >
      {teamOutlook && <LineupSummary teamOutlook={teamOutlook} players={players} />}

      <ColumnRail
        layout={lineupLayout}
        valueColumns={valueColumns}
        openPicker={openPicker}
        onTogglePicker={onTogglePicker}
        onSelectColumn={onSelectColumn}
      />

      {/* One scroll box over both sections rather than one each, because the
          bench is where a reader is heading when they scroll at all and a
          starters list that held its own scrollbar would put a boundary in the
          middle of one lineup. The footnote and the picks travel with it: they
          are the tail of this list, not a fixed footer over it — where the
          standings' week range is fixed because it qualifies numbers that are
          on screen the whole time. */}
      <div className="min-h-0 overflow-y-auto overscroll-contain">
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
              horizon={horizon}
              promoted={teamOutlook?.start.includes(row.player_id)}
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
                horizon={horizon}
                benched={teamOutlook?.sit.includes(id)}
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
 * The two value columns' headings, once for the whole half.
 *
 * They used to sit in each section's own heading, which drew the same two labels
 * twice — one selection, two places claiming it, since a pick in either moves
 * both — and put a control inside the box that scrolls. Both matter now that this
 * half scrolls: a picker carried off the top takes the only thing naming those
 * columns with it, and its menu (absolutely positioned, overhanging the rows
 * under it) would be clipped by the scroll box the moment it opened. Hoisted, it
 * is the same rail the leagues list draws above its cards, for the same reason —
 * a list-wide selection named once above the list rather than on every row.
 *
 * Laid on the sections' own grid so each label sits over the numbers it names.
 * The name track is left empty rather than captioned: the section titles under
 * it already say what the rows are, and a second heading word stacked on the
 * first would be the duplication this just removed.
 */
function ColumnRail({
  layout,
  valueColumns,
  openPicker,
  onTogglePicker,
  onSelectColumn,
}: {
  layout: SectionLayout;
  /** The two value columns' metric keys — empty when the half shows no numbers. */
  valueColumns: string[];
  openPicker: string | null;
  onTogglePicker: (key: string) => void;
  onSelectColumn: (slot: number, key: string) => void;
}) {
  // Nothing to name, so no rail: a league with no projections and nothing priced
  // would otherwise spend a line on two empty tracks.
  if (valueColumns.length === 0) return null;

  return (
    <div className={`mb-1.5 grid shrink-0 ${layout.grid} items-baseline gap-x-2`}>
      <span />
      <span />
      {valueColumns.map((key, slot) => (
        <ColumnPicker
          key={slot}
          // Paired with the layout's grid template and the rows' own cells: the
          // second column appears only once this half is wide enough.
          wrapperClassName={slot === 0 ? "inline-flex" : "hidden @xl:inline-flex"}
          className="text-[0.6rem]"
          options={PLAYER_METRIC_OPTIONS}
          activeKey={key}
          open={openPicker === `roster-${slot}`}
          onToggle={() => onTogglePicker(`roster-${slot}`)}
          onSelect={(metricKey) => onSelectColumn(slot, metricKey)}
        />
      ))}
    </div>
  );
}

/**
 * Which players to move to reach the optimal lineup, and what the lineup misses.
 *
 * Two totals are deliberately not here. The optimal one is what the standings
 * beside this panel are ranked on — the selected row states it under whichever
 * projection column is aimed at it, with the horizon spelled out once in that
 * table's footer — so a chip repeating it above the lineup it belongs to was the
 * same claim twice, and the second one had to carry its own week range to be
 * honest. The *gap* has now left for the same reason: it is a headline about this
 * team rather than a note on its bench, so it is a cell in the panel's readout
 * strip, where it sits beside the two totals it is the difference between. Two
 * places for one number is one edit away from them disagreeing.
 *
 * What is left is the part neither the table nor the readout can say: the names.
 */
function LineupSummary({
  teamOutlook,
  players,
}: {
  teamOutlook: TeamOutlook;
  players: Record<string, PlayerSummary>;
}) {
  const name = (id: string) => players[id]?.name ?? id;
  const moves = teamOutlook.start.length > 0 || teamOutlook.sit.length > 0;
  if (!moves && teamOutlook.unknown_slots.length === 0) return null;

  return (
    // `mb-3` rather than the section below taking `mt-3`: the rail sits between
    // the two now, and this half's head has to hold its own gap since only what
    // is under it scrolls.
    <div className="mb-3 shrink-0 space-y-1.5">
      {moves && (
        <p className="text-[0.7rem] leading-relaxed text-foreground/50">
          {teamOutlook.start.length > 0 && (
            <>
              <span className="font-semibold text-active">start</span>{" "}
              {teamOutlook.start.map(name).join(", ")}
            </>
          )}
          {teamOutlook.start.length > 0 && teamOutlook.sit.length > 0 && " · "}
          {teamOutlook.sit.length > 0 && (
            <>
              <span className="font-semibold text-foreground/70">sit</span>{" "}
              {teamOutlook.sit.map(name).join(", ")}
            </>
          )}
        </p>
      )}

      {teamOutlook.unknown_slots.length > 0 && (
        <p className="text-[0.7rem] text-foreground/40">
          {teamOutlook.unknown_slots.join(", ")} left out — this lineup covers only
          part of the roster.
        </p>
      )}
    </div>
  );
}

/**
 * A titled group of rows.
 *
 * Laid out on the same grid as its rows, so the title starts where the names do —
 * the first cell is the empty slot gutter. It names the *rows*; what names the
 * numbers beside them is {@link ColumnRail}, once for both sections, above the
 * box this scrolls in.
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
    <div className="mt-3 first:mt-0">
      <div className={`mb-1.5 grid ${layout.grid} items-baseline gap-x-2`}>
        <span />
        {/* 0.65rem below @lg, the size the standings' own heading row uses at that
            tier and for the same reason: this heading shares the name's track, so
            at 12px "Starters" was wider than the track and truncated to "STARTE…"
            — a heading clipped inside its own word reads as broken where a
            clipped *name* only reads as long. */}
        {/* `h3`, not `h5`: the league name this panel belongs to is an `h2`, so
            a 5 here skipped two levels. The size is a class either way. */}
        <h3 className="min-w-0 truncate text-[0.65rem] font-medium uppercase tracking-wide text-foreground/35 @lg:text-xs">
          {title}
        </h3>
      </div>
      <ul className="flex flex-col divide-y divide-foreground/5">{children}</ul>
    </div>
  );
}

/**
 * A dim line saying what the KTC and ADP columns rest on — the board they were
 * priced against and, for ADP, how many crawled drafts stood behind it — shown
 * only while one of those columns is selected. The same "say what the number
 * rests on" habit the standings footer and the outlook caveat keep, and the
 * reminder that KTC is a dynasty board and ADP a market consensus, not points.
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
