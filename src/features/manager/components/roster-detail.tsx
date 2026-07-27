import { useMemo } from "react";

import { formatPoints, formatRecord } from "../format";
import type { LeagueTeamView, PlayerSummary } from "../types";
import { PositionBadge, teamLabel, TeamAvatar } from "./ui";

/** Roster slots that aren't part of the active starting lineup. */
const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);

/**
 * One team's full roster, grouped into starters, bench, IR and taxi.
 *
 * Below the `@lg` container width the record drops onto its own line under the
 * team name instead of competing with it for horizontal space.
 */
export function RosterDetail({
  team,
  players,
  rosterPositions,
}: {
  team: LeagueTeamView;
  players: Record<string, PlayerSummary>;
  rosterPositions: string[] | null;
}) {
  // Starters are positionally aligned with the league's non-bench slots.
  const startingSlots = useMemo(
    () => (rosterPositions ?? []).filter((p) => !BENCH_SLOTS.has(p)),
    [rosterPositions],
  );

  const bench = useMemo(() => {
    const onField = new Set([...team.starters, ...team.reserve, ...team.taxi]);
    return team.players.filter((id) => id && !onField.has(id));
  }, [team]);

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

      <RosterSection title="Starters">
        {team.starters.map((id, i) => (
          <PlayerRow
            key={`s-${i}`}
            player={players[id]}
            playerId={id}
            slot={startingSlots[i] ?? "FLEX"}
          />
        ))}
      </RosterSection>

      {bench.length > 0 && (
        <RosterSection title="Bench">
          {bench.map((id) => (
            <PlayerRow key={id} player={players[id]} playerId={id} />
          ))}
        </RosterSection>
      )}

      {team.reserve.length > 0 && (
        <RosterSection title="IR">
          {team.reserve.map((id) => (
            <PlayerRow key={id} player={players[id]} playerId={id} slot="IR" />
          ))}
        </RosterSection>
      )}

      {team.taxi.length > 0 && (
        <RosterSection title="Taxi">
          {team.taxi.map((id) => (
            <PlayerRow key={id} player={players[id]} playerId={id} slot="TX" />
          ))}
        </RosterSection>
      )}
    </div>
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
}: {
  player: PlayerSummary | undefined;
  playerId: string;
  slot?: string;
}) {
  // Sleeper pads an unfilled starting slot with an empty id or a literal "0".
  const empty = !playerId || playerId === "0";
  const name = empty ? "Empty" : (player?.name ?? playerId);

  return (
    <li className="flex items-center gap-1 py-1.5 @lg:gap-2">
      {slot ? (
        <span className="w-6 shrink-0 text-center text-[0.65rem] font-semibold uppercase text-foreground/35 @lg:w-9 @lg:text-[0.7rem]">
          {slot}
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
    </li>
  );
}
