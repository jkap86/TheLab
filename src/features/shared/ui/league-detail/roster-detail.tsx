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
 * to the season total or to this player's KTC and ADP value from the heading's
 * picker. Which metric each shows is held above this panel so the two sections'
 * columns line up and one picker moves the whole column.
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
    <div
      className={`lab-plate lab-plate-sm rounded-lg p-1.5 @lg:p-4 ${
        elevated ? "relative z-30" : ""
      }`}
    >
      {teamOutlook && <LineupSummary teamOutlook={teamOutlook} players={players} />}

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
    <div className="space-y-1.5">
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
    // `first:mt-0` because the lineup summary above is conditional: with nothing
    // to say about the bench, the Starters heading is the panel's first line.
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
        {valueColumns.map((key, slot) => (
          <ColumnPicker
            key={slot}
            // Paired with the layout's grid template and the rows' own cells:
            // the second column appears only once this half is wide enough.
            wrapperClassName={
              slot === 0 ? "inline-flex" : "hidden @xl:inline-flex"
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
