"use client";

import { useMemo, useState } from "react";

import { useLeagueDetail } from "../hooks/use-league-detail";
import type { LeagueDetailResult, LeagueTeamView, PlayerSummary } from "../types";

/** Roster slots that aren't part of the active starting lineup. */
const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);

const POSITION_TONE: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300",
  RB: "bg-emerald-500/15 text-emerald-300",
  WR: "bg-sky-500/15 text-sky-300",
  TE: "bg-amber-500/15 text-amber-300",
  K: "bg-violet-500/15 text-violet-300",
  DEF: "bg-teal-500/15 text-teal-300",
};

function teamLabel(team: LeagueTeamView): string {
  return (
    team.manager?.team_name ||
    team.manager?.display_name ||
    `Roster ${team.roster_id}`
  );
}

export function LeagueDetailPanel({ leagueId }: { leagueId: string }) {
  const { data, loading, error } = useLeagueDetail(leagueId, true);

  if (loading && !data) {
    return <PanelMessage>Loading rosters…</PanelMessage>;
  }
  if (error) {
    return <PanelMessage tone="error">{error}</PanelMessage>;
  }
  if (!data || data.teams.length === 0) {
    return <PanelMessage>No roster data yet.</PanelMessage>;
  }

  return <Panel data={data} />;
}

function Panel({ data }: { data: LeagueDetailResult }) {
  const [selectedId, setSelectedId] = useState<number>(data.teams[0].roster_id);
  const selected =
    data.teams.find((t) => t.roster_id === selectedId) ?? data.teams[0];

  // Even 50/50 split at every width; the children use @lg container queries to
  // shed non-essential columns once each half gets tight.
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2 @lg:gap-4">
        <Standings
          teams={data.teams}
          selectedId={selected.roster_id}
          onSelect={setSelectedId}
        />
        <RosterDetail
          team={selected}
          players={data.players}
          rosterPositions={data.roster_positions}
        />
      </div>
    </div>
  );
}

function Standings({
  teams,
  selectedId,
  onSelect,
}: {
  teams: LeagueTeamView[];
  selectedId: number;
  onSelect: (rosterId: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-1 border-b border-white/10 bg-white/[0.03] px-1.5 py-2 text-[0.65rem] uppercase tracking-wide text-white/40 @lg:grid-cols-[2rem_minmax(0,1fr)_auto] @lg:gap-2 @lg:px-3 @lg:text-xs">
        <span className="text-center">#</span>
        <span className="truncate">Manager</span>
        <span className="hidden text-right @lg:block">Rec</span>
      </div>
      <ul>
        {teams.map((team, i) => {
          const active = team.roster_id === selectedId;
          const record = `${team.record.wins}-${team.record.losses}${
            team.record.ties ? `-${team.record.ties}` : ""
          }`;
          const fpts = team.fpts.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          return (
            <li key={team.roster_id}>
              <button
                type="button"
                onClick={() => onSelect(team.roster_id)}
                title={teamLabel(team)}
                className={`grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-1 border-l-2 px-1.5 py-1.5 text-left transition-colors @lg:grid-cols-[2rem_minmax(0,1fr)_auto] @lg:gap-2 @lg:px-3 @lg:py-2 ${
                  active
                    ? "border-active bg-active/10"
                    : "border-transparent hover:bg-white/[0.04]"
                }`}
              >
                <span className="text-center text-[0.65rem] tabular-nums text-white/40 @lg:text-sm">
                  {i + 1}
                </span>
                <span className="flex min-w-0 items-center gap-1 @lg:gap-2">
                  <Avatar team={team} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-white/90 @lg:text-sm">
                      {teamLabel(team)}
                    </span>
                    {/* Narrow: record folds onto the second line so it doesn't
                        need a column of its own. */}
                    <span className="block truncate text-[0.65rem] tabular-nums text-white/40 @lg:hidden">
                      {record} · {fpts}
                    </span>
                    <span className="hidden truncate text-xs tabular-nums text-white/40 @lg:block">
                      {fpts} PF
                    </span>
                  </span>
                </span>
                <span className="hidden text-right text-sm tabular-nums text-white/70 @lg:block">
                  {record}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RosterDetail({
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
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5 @lg:p-4">
      {/* Narrow: record drops to its own line under the name instead of
          competing with it for horizontal space. */}
      <div className="border-b border-white/10 pb-3 @lg:flex @lg:items-center @lg:gap-3 @lg:pb-4">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar team={team} size="lg" />
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-white/90 @lg:text-base">
              {teamLabel(team)}
            </h4>
            {team.manager?.team_name && team.manager.display_name && (
              <p className="truncate text-xs text-white/45">
                {team.manager.display_name}
              </p>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2 text-sm @lg:mt-0 @lg:ml-auto @lg:block @lg:shrink-0 @lg:text-right">
          <span className="tabular-nums font-medium text-white/85">
            {team.record.wins}-{team.record.losses}
            {team.record.ties ? `-${team.record.ties}` : ""}
          </span>
          <span className="block tabular-nums text-xs text-white/45">
            {team.fpts.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            PF
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
      <h5 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/35">
        {title}
      </h5>
      <ul className="flex flex-col divide-y divide-white/5">{children}</ul>
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
  const empty = !playerId || playerId === "0";
  const name = empty ? "Empty" : (player?.name ?? playerId);
  const position = player?.position ?? null;

  return (
    <li className="flex items-center gap-1 py-1.5 @lg:gap-2">
      {slot ? (
        <span className="w-6 shrink-0 text-center text-[0.65rem] font-semibold uppercase text-white/35 @lg:w-9 @lg:text-[0.7rem]">
          {slot}
        </span>
      ) : null}
      {/* The badge duplicates the slot label, so at narrow widths it only
          earns its space on rows that have no slot (bench). */}
      <PositionBadge
        position={position}
        className={slot ? "hidden @lg:inline-flex" : undefined}
      />
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          empty ? "text-white/25" : "text-white/85"
        }`}
      >
        {name}
      </span>
      {player?.team && (
        <span className="hidden shrink-0 text-xs tabular-nums text-white/35 @sm:inline">
          {player.team}
        </span>
      )}
    </li>
  );
}

function PositionBadge({
  position,
  className = "inline-flex",
}: {
  position: string | null;
  className?: string;
}) {
  const tone = (position && POSITION_TONE[position]) || "bg-white/5 text-white/40";
  return (
    <span
      className={`w-8 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[0.65rem] font-bold ${tone} ${className}`}
    >
      {position ?? "–"}
    </span>
  );
}

function Avatar({
  team,
  size = "sm",
}: {
  team: LeagueTeamView;
  size?: "sm" | "lg";
}) {
  const dim =
    size === "lg"
      ? "h-7 w-7 text-xs @lg:h-9 @lg:w-9 @lg:text-sm"
      : "h-5 w-5 text-[0.6rem] @lg:h-6 @lg:w-6 @lg:text-xs";
  const url = team.manager?.avatar_url;
  if (url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={url}
        alt=""
        className={`${dim} shrink-0 rounded-full border border-white/10 object-cover`}
      />
    );
  }
  return (
    <span
      className={`${dim} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 font-semibold text-white/40`}
    >
      {teamLabel(team).charAt(0).toUpperCase()}
    </span>
  );
}

function PanelMessage({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={`rounded-lg border px-4 py-6 text-center text-sm ${
        tone === "error"
          ? "border-red-500/20 bg-red-500/5 text-red-300"
          : "border-white/10 bg-white/[0.02] text-white/45"
      }`}
    >
      {children}
    </p>
  );
}
