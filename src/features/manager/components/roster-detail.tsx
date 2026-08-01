"use client";

import { useMemo } from "react";

// Imported directly rather than through the projections barrel, which would
// pull `pg`-backed code into the client bundle — see `slots.ts`.
import { NON_STARTING_SLOTS } from "@/shared/projections/slots";

import { formatPoints, formatRecord, formatWeekRange } from "../format";
import { PLAYER_METRICS } from "../roster-metrics";
import type {
  LeagueOutlook,
  LeagueRosterValues,
  LeagueTeamView,
  PlayerSummary,
  TeamOutlook,
} from "../types";
import { ColumnPicker, type ColumnOption } from "./column-picker";
import { DraftPicks } from "./draft-picks";
import { PlayerRow } from "./player-row";
import { NO_NUMBERS, SPLIT_LAYOUT } from "./roster-layout";
import type { SectionLayout } from "./roster-layout";
import { teamLabel, TeamAvatar } from "./ui";

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
 * to the season total or to this player's KTC and ADP value from the heading's
 * picker. Which metric each shows is held above this panel so the two sections'
 * columns line up and one picker moves the whole column.
 *
 * Below the `@lg` container width the record drops onto its own line under the
 * team name instead of competing with it for horizontal space.
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
    <div
      className={`rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2.5 @lg:p-4 ${
        elevated ? "relative z-30" : ""
      }`}
    >
      {/* A recessed plate rather than a rule underneath: the app bar's grammar
          says a well is the thing being read, and this names the team every list
          below it belongs to. It carries no layout of its own (see the `.lab-*`
          rule in globals.css) — the box comes from the utilities here.

          The record still drops under the name below @lg: this half is ~150px on
          a phone, which a name and two numbers on one line don't share. */}
      <div className="lab-well rounded-lg px-2.5 py-2 @lg:flex @lg:items-center @lg:gap-3 @lg:px-3 @lg:py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <TeamAvatar team={team} size="md" />
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-foreground/90 @lg:text-base">
              {teamLabel(team)}
            </h4>
            {team.manager?.team_name && team.manager.display_name && (
              <p className="truncate text-xs text-foreground/45">
                {team.manager.display_name}
              </p>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2 text-sm @lg:mt-0 @lg:ml-auto @lg:block @lg:shrink-0 @lg:text-right">
          <span className="font-medium tabular-nums text-foreground/85">
            {formatRecord(team.record)}
          </span>
          <span className="block text-xs tabular-nums text-foreground/45">
            {formatPoints(team.fpts)} PF
          </span>
        </div>
      </div>

      {teamOutlook && outlook && (
        <LineupSummary
          teamOutlook={teamOutlook}
          weeks={outlook.weeks}
          players={players}
        />
      )}

      <RosterSection
        title="Starters"
        layout={lineupLayout}
        valueColumns={valueColumns}
        sectionKey="starters"
        openPicker={openPicker}
        onTogglePicker={onTogglePicker}
        onSelectColumn={onSelectColumn}
      >
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
        <RosterSection
          title="Bench"
          layout={lineupLayout}
          valueColumns={valueColumns}
          sectionKey="bench"
          openPicker={openPicker}
          onTogglePicker={onTogglePicker}
          onSelectColumn={onSelectColumn}
        >
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
  );
}

/**
 * The optimal lineup's projected total, and what it would take to get there.
 *
 * The week range sits beside it because the horizon is whatever has been synced,
 * not a fixed span — a short backfill shortens the number without invalidating
 * it, so it is stated rather than left to be assumed.
 */
function LineupSummary({
  teamOutlook,
  weeks,
  players,
}: {
  teamOutlook: TeamOutlook;
  weeks: number[];
  players: Record<string, PlayerSummary>;
}) {
  const name = (id: string) => players[id]?.name ?? id;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-baseline gap-1.5 rounded-md bg-active/10 px-2 py-1 text-[0.7rem] text-active">
          <span className="font-medium">Optimal</span>
          <span className="tabular-nums">
            {formatPoints(teamOutlook.optimal_points)}
          </span>
        </span>
        <span className="text-[0.65rem] uppercase tracking-wide text-foreground/35">
          proj · {formatWeekRange(weeks)}
        </span>
      </div>

      {teamOutlook.points_left > 0 && (
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-foreground/50">
          <span className="font-semibold text-active">
            +{formatPoints(teamOutlook.points_left)}
          </span>{" "}
          on the bench
          {teamOutlook.start.length > 0 && (
            <> · start {teamOutlook.start.map(name).join(", ")}</>
          )}
          {teamOutlook.sit.length > 0 && (
            <> · sit {teamOutlook.sit.map(name).join(", ")}</>
          )}
        </p>
      )}

      {teamOutlook.unknown_slots.length > 0 && (
        <p className="mt-1.5 text-[0.7rem] text-foreground/40">
          {teamOutlook.unknown_slots.join(", ")} left out — this lineup covers only
          part of the roster.
        </p>
      )}
    </div>
  );
}

/**
 * A titled group of rows, with the numeric columns labelled once at the top
 * rather than on every row.
 *
 * Laid out on the same grid as its rows, so the headings sit over the numbers they
 * name. The first cell is the empty slot gutter — the headings start where the
 * names do. Each value column's heading is a picker: clicking it swaps the whole
 * column (in both sections at once) to another metric.
 */
function RosterSection({
  title,
  layout,
  valueColumns,
  sectionKey,
  openPicker,
  onTogglePicker,
  onSelectColumn,
  children,
}: {
  title: string;
  layout: SectionLayout;
  /** The two value columns' metric keys — empty when the section shows no numbers. */
  valueColumns: string[];
  /** Distinguishes this section's open picker from the other's; selection is shared. */
  sectionKey: string;
  openPicker: string | null;
  onTogglePicker: (key: string) => void;
  onSelectColumn: (slot: number, key: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div
        className={`mb-1.5 grid ${layout.grid} items-baseline gap-x-1 @lg:gap-x-2`}
      >
        <span />
        <h5 className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-foreground/35">
          {title}
        </h5>
        {valueColumns.map((key, slot) => (
          <ColumnPicker
            key={slot}
            // Paired with the layout's grid template and the rows' own cells:
            // the second column appears only once this half is wide enough.
            wrapperClassName={
              slot === 0 ? "inline-flex" : "hidden @lg:inline-flex"
            }
            className="text-[0.6rem]"
            options={PLAYER_METRIC_OPTIONS}
            activeKey={key}
            open={openPicker === `${sectionKey}-${slot}`}
            onToggle={() => onTogglePicker(`${sectionKey}-${slot}`)}
            onSelect={(metricKey) => onSelectColumn(slot, metricKey)}
          />
        ))}
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
          ADP · draft-capital value off {board} {values.adp_league_type} drafts
          {values.adp_draft_count > 0 &&
            ` · over ${values.adp_draft_count} crawled draft${
              values.adp_draft_count === 1 ? "" : "s"
            }`}
        </p>
      )}
    </div>
  );
}
