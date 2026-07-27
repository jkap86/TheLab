"use client";

import { useMemo, useState } from "react";

import { formatPoints, formatRecord, formatWeekRange } from "../format";
import type {
  LeagueOutlook,
  LeagueTeamView,
  PlayerOutlook,
  PlayerSummary,
  TeamOutlook,
} from "../types";
import { PositionBadge, teamLabel, TeamAvatar } from "./ui";

/** Roster slots that aren't part of the active starting lineup. */
const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);

/**
 * Short labels for the slots whose Sleeper names don't fit the column.
 *
 * The overlapping flexes have the longest names and are exactly the ones a
 * reader has to tell apart — `WRRB_FLEX` and `REC_FLEX` both truncate to
 * something unreadable, so they get the RB/WR and WR/TE spellings instead.
 */
const SLOT_LABEL: Record<string, string> = {
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  SUPER_FLEX: "SFLX",
  IDP_FLEX: "IDP",
};

/** Which lineup the starters section is showing. */
type View = "current" | "optimal";

/** A row of the starters list: a slot and who is in it. */
type SlotRow = { slot: string; player_id: string };

/**
 * One team's full roster, grouped into starters, bench, IR and taxi, with each
 * player's projected points for the rest of the season.
 *
 * The starters section switches between what the team is starting and the best
 * lineup available to it (see `outlook`), and the bench follows: a player the
 * optimal lineup starts moves up out of the bench when that view is on, so the
 * two lists always read as one lineup.
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
  const [view, setView] = useState<View>("current");

  const teamOutlook = useMemo(
    () => outlook?.teams.find((t) => t.roster_id === team.roster_id) ?? null,
    [outlook, team.roster_id],
  );

  // Starters are positionally aligned with the league's non-bench slots. The
  // outlook has already done that pairing (and dropped any slot it doesn't
  // recognise), so it is only redone here for a league with no projections.
  const starters: SlotRow[] = useMemo(() => {
    const lineup = teamOutlook?.[view];
    if (lineup) {
      return lineup.map((s) => ({ slot: s.slot, player_id: s.player_id ?? "" }));
    }

    const slots = (rosterPositions ?? []).filter((p) => !BENCH_SLOTS.has(p));
    return team.starters.map((id, i) => ({ slot: slots[i] ?? "FLEX", player_id: id }));
  }, [teamOutlook, view, rosterPositions, team.starters]);

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
        <LineupSwitch
          teamOutlook={teamOutlook}
          weeks={outlook.weeks}
          view={view}
          onChange={setView}
          players={players}
        />
      )}

      <RosterSection title="Starters">
        {starters.map((row, i) => (
          <PlayerRow
            key={`s-${i}`}
            player={players[row.player_id]}
            playerId={row.player_id}
            slot={row.slot}
            outlook={outlook?.players[row.player_id]}
            horizon={horizon}
            promoted={view === "optimal" && teamOutlook?.start.includes(row.player_id)}
          />
        ))}
      </RosterSection>

      {bench.length > 0 && (
        <RosterSection title="Bench">
          {bench.map((id) => (
            <PlayerRow
              key={id}
              player={players[id]}
              playerId={id}
              outlook={outlook?.players[id]}
              horizon={horizon}
              benched={view === "optimal" && teamOutlook?.sit.includes(id)}
            />
          ))}
        </RosterSection>
      )}

      {/* IR and taxi still show a projection — it is what a stash decision turns
          on — but they are never candidates for the lineup above, since Sleeper
          won't let them start. */}
      {team.reserve.length > 0 && (
        <RosterSection title="IR">
          {team.reserve.map((id) => (
            <PlayerRow
              key={id}
              player={players[id]}
              playerId={id}
              slot="IR"
              outlook={outlook?.players[id]}
              horizon={horizon}
            />
          ))}
        </RosterSection>
      )}

      {team.taxi.length > 0 && (
        <RosterSection title="Taxi">
          {team.taxi.map((id) => (
            <PlayerRow
              key={id}
              player={players[id]}
              playerId={id}
              slot="TX"
              outlook={outlook?.players[id]}
              horizon={horizon}
            />
          ))}
        </RosterSection>
      )}
    </div>
  );
}

/**
 * The current/optimal switch, with each lineup's projected total on its own
 * button — the gap between the two numbers is the whole point, so it is shown
 * rather than made something to work out by toggling.
 *
 * The week range sits beside it because the horizon is not what a reader would
 * assume: the projections sync keeps a short window warm, so "rest of season" is
 * usually a couple of weeks deep.
 */
function LineupSwitch({
  teamOutlook,
  weeks,
  view,
  onChange,
  players,
}: {
  teamOutlook: TeamOutlook;
  weeks: number[];
  view: View;
  onChange: (view: View) => void;
  players: Record<string, PlayerSummary>;
}) {
  const name = (id: string) => players[id]?.name ?? id;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex rounded-md border border-foreground/10 p-0.5">
          <SwitchButton
            active={view === "current"}
            onClick={() => onChange("current")}
            label="Current"
            points={teamOutlook.current_points}
          />
          <SwitchButton
            active={view === "optimal"}
            onClick={() => onChange("optimal")}
            label="Optimal"
            points={teamOutlook.optimal_points}
          />
        </div>
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

function SwitchButton({
  active,
  onClick,
  label,
  points,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  points: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-baseline gap-1.5 rounded px-2 py-1 text-[0.7rem] transition-colors ${
        active
          ? "bg-active/10 text-active"
          : "text-foreground/45 hover:bg-foreground/[0.04]"
      }`}
    >
      <span className="font-medium">{label}</span>
      <span className="tabular-nums">{formatPoints(points)}</span>
    </button>
  );
}

function RosterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <h5 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground/35">
        {title}
      </h5>
      <ul className="flex flex-col divide-y divide-foreground/5">{children}</ul>
    </div>
  );
}

function PlayerRow({
  player,
  playerId,
  slot,
  outlook,
  horizon = 0,
  promoted,
  benched,
}: {
  player: PlayerSummary | undefined;
  playerId: string;
  slot?: string;
  outlook?: PlayerOutlook;
  /** Weeks the projection covers, so a partial one can be marked as such. */
  horizon?: number;
  /** Starting here only in the optimal lineup. */
  promoted?: boolean;
  /** Started today, but sat by the optimal lineup. */
  benched?: boolean;
}) {
  // Sleeper pads an unfilled starting slot with an empty id or a literal "0".
  const empty = !playerId || playerId === "0";
  const name = empty ? "Empty" : (player?.name ?? playerId);

  return (
    <li
      className={`flex items-center gap-1 py-1.5 @lg:gap-2 ${
        promoted ? "bg-active/[0.07]" : benched ? "opacity-50" : ""
      }`}
    >
      {slot ? (
        <span className="w-7 shrink-0 truncate text-center text-[0.65rem] font-semibold uppercase text-foreground/35 @lg:w-10 @lg:text-[0.7rem]">
          {SLOT_LABEL[slot] ?? slot}
        </span>
      ) : null}
      {/* The badge duplicates the slot label, so at narrow widths it only
          earns its space on rows that have no slot (bench). */}
      <PositionBadge
        position={player?.position ?? null}
        className={slot ? "hidden @lg:inline-flex" : undefined}
      />
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          empty ? "text-foreground/25" : "text-foreground/85"
        }`}
      >
        {name}
      </span>
      {player?.team && (
        <span className="hidden shrink-0 text-xs tabular-nums text-foreground/35 @sm:inline">
          {player.team}
        </span>
      )}
      {!empty && <ProjectedPoints outlook={outlook} horizon={horizon} />}
    </li>
  );
}

/**
 * A player's projected points over the horizon.
 *
 * An em dash rather than 0.00 when there is no projection at all: a player
 * Sleeper hasn't projected and a player projected to score nothing are different
 * claims, and the roster shouldn't make the stronger one. A player projected for
 * fewer weeks than the horizon — a bye, or a week not yet published — is marked
 * so a total that looks low can be read as short rather than bad.
 */
function ProjectedPoints({
  outlook,
  horizon,
}: {
  outlook?: PlayerOutlook;
  horizon: number;
}) {
  if (horizon === 0) return null;

  if (!outlook) {
    return (
      <span
        title="No projection"
        className="w-12 shrink-0 text-right text-xs tabular-nums text-foreground/25"
      >
        —
      </span>
    );
  }

  const partial = outlook.weeks < horizon;
  return (
    <span
      title={`${formatPoints(outlook.points)} projected over ${outlook.weeks} of ${horizon} week${horizon === 1 ? "" : "s"}`}
      className="w-12 shrink-0 text-right text-xs tabular-nums text-foreground/70"
    >
      {formatPoints(outlook.points)}
      {partial && <span className="text-foreground/30">*</span>}
    </span>
  );
}
