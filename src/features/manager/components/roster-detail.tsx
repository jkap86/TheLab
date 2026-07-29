"use client";

import { useMemo } from "react";

// Imported directly rather than through the projections barrel, which would
// pull `pg`-backed code into the client bundle — see `slots.ts`.
import { NON_STARTING_SLOTS } from "@/shared/projections/slots";

import { formatPoints, formatRecord, formatWeekRange } from "../format";
import type {
  LeagueOutlook,
  LeagueTeamView,
  PlayerSummary,
  TeamOutlook,
} from "../types";
import { PlayerRow } from "./player-row";
import { NO_NUMBERS, SPLIT_LAYOUT, TOTAL_LAYOUT } from "./roster-layout";
import type { SectionLayout } from "./roster-layout";
import { teamLabel, TeamAvatar } from "./ui";

/** A row of the starters list: a slot and who is in it. */
type SlotRow = { slot: string; player_id: string };

/**
 * One team's full roster, grouped into starters, bench, IR and taxi, with each
 * player's projected points for the rest of the season.
 *
 * The starters section shows the *best* lineup available to the team, not what
 * it is currently starting (see `outlook`), and the bench follows: a player the
 * optimal lineup starts is listed as a starter and highlighted, one it sits is
 * dimmed on the bench, so the two lists always read as one lineup.
 *
 * Below the `@lg` container width the record drops onto its own line under the
 * team name instead of competing with it for horizontal space.
 */
export function RosterDetail({
  team,
  players,
  rosterPositions,
  outlook,
}: {
  team: LeagueTeamView;
  players: Record<string, PlayerSummary>;
  rosterPositions: string[] | null;
  outlook: LeagueOutlook | null;
}) {
  const teamOutlook = useMemo(
    () => outlook?.teams.find((t) => t.roster_id === team.roster_id) ?? null,
    [outlook, team.roster_id],
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
    const onField = new Set([
      ...starters.map((s) => s.player_id),
      ...team.reserve,
      ...team.taxi,
    ]);
    const rest = team.players.filter((id) => id && !onField.has(id));

    // Best available first once there are projections to sort on: the point of
    // the bench in a lineup tool is who you might promote off it.
    if (!outlook) return rest;
    return [...rest].sort(
      (a, b) => (outlook.players[b]?.points ?? 0) - (outlook.players[a]?.points ?? 0),
    );
  }, [starters, team, outlook]);

  const horizon = outlook?.weeks.length ?? 0;

  // No projections means no number columns at all, so the headings go too — a
  // "start / bench" label over a column of em dashes promises a breakdown that
  // isn't there.
  const lineupLayout = horizon > 0 ? SPLIT_LAYOUT : NO_NUMBERS;
  const stashLayout = horizon > 0 ? TOTAL_LAYOUT : NO_NUMBERS;

  return (
    <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2.5 @lg:p-4">
      <div className="border-b border-foreground/10 pb-3 @lg:flex @lg:items-center @lg:gap-3 @lg:pb-4">
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
          <span className="tabular-nums font-medium text-foreground/85">
            {formatRecord(team.record)}
          </span>
          <span className="block tabular-nums text-xs text-foreground/45">
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
              horizon={horizon}
              benched={teamOutlook?.sit.includes(id)}
            />
          ))}
        </RosterSection>
      )}

      {/* IR and taxi still show a projection — it is what a stash decision turns
          on — but they are never candidates for the lineup above, since Sleeper
          won't let them start. That is also why they get the season total rather
          than the split: a player who cannot start has no starting half. */}
      {team.reserve.length > 0 && (
        <RosterSection title="IR" layout={stashLayout}>
          {team.reserve.map((id) => (
            <PlayerRow
              key={id}
              player={players[id]}
              playerId={id}
              slot="IR"
              outlook={outlook?.players[id]}
              layout={stashLayout}
              horizon={horizon}
            />
          ))}
        </RosterSection>
      )}

      {team.taxi.length > 0 && (
        <RosterSection title="Taxi" layout={stashLayout}>
          {team.taxi.map((id) => (
            <PlayerRow
              key={id}
              player={players[id]}
              playerId={id}
              slot="TX"
              outlook={outlook?.players[id]}
              layout={stashLayout}
              horizon={horizon}
            />
          ))}
        </RosterSection>
      )}
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
 * names do.
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
    <div className="mt-3">
      <div
        className={`mb-1.5 grid ${layout.grid} items-baseline gap-x-1 @lg:gap-x-2`}
      >
        <span />
        <h5 className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-foreground/35">
          {title}
        </h5>
        {layout.columns.map((label) => (
          <span
            key={label}
            className="text-right text-[0.6rem] uppercase tracking-wide text-foreground/30"
          >
            {label}
          </span>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-foreground/5">{children}</ul>
    </div>
  );
}
