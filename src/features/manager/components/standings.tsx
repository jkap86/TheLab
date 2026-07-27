import { formatPoints, formatRecord } from "../format";
import type { LeagueTeamView } from "../types";
import { teamLabel, TeamAvatar } from "./ui";

/**
 * The league table, in standings order. Selecting a row drives the roster panel
 * beside it.
 *
 * Below the `@lg` container width the record moves onto a second line under the
 * team name rather than keeping a column of its own — at a 50/50 split there
 * isn't room for both.
 */
export function Standings({
  teams,
  selectedId,
  onSelect,
}: {
  teams: LeagueTeamView[];
  selectedId: number;
  onSelect: (rosterId: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-foreground/10">
      <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-1 border-b border-foreground/10 bg-foreground/[0.03] px-1.5 py-2 text-[0.65rem] uppercase tracking-wide text-foreground/40 @lg:grid-cols-[2rem_minmax(0,1fr)_auto] @lg:gap-2 @lg:px-3 @lg:text-xs">
        <span className="text-center">#</span>
        <span className="truncate">Manager</span>
        <span className="hidden text-right @lg:block">Rec</span>
      </div>
      <ul>
        {teams.map((team, i) => (
          <StandingsRow
            key={team.roster_id}
            team={team}
            rank={i + 1}
            active={team.roster_id === selectedId}
            onSelect={() => onSelect(team.roster_id)}
          />
        ))}
      </ul>
    </div>
  );
}

function StandingsRow({
  team,
  rank,
  active,
  onSelect,
}: {
  team: LeagueTeamView;
  rank: number;
  active: boolean;
  onSelect: () => void;
}) {
  const record = formatRecord(team.record);
  const points = formatPoints(team.fpts);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={teamLabel(team)}
        aria-current={active ? "true" : undefined}
        className={`grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-1 border-l-2 px-1.5 py-1.5 text-left transition-colors @lg:grid-cols-[2rem_minmax(0,1fr)_auto] @lg:gap-2 @lg:px-3 @lg:py-2 ${
          active
            ? "border-active bg-active/10"
            : "border-transparent hover:bg-foreground/[0.04]"
        }`}
      >
        <span className="text-center text-[0.65rem] tabular-nums text-foreground/40 @lg:text-sm">
          {rank}
        </span>
        <span className="flex min-w-0 items-center gap-1 @lg:gap-2">
          <TeamAvatar team={team} />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-foreground/90 @lg:text-sm">
              {teamLabel(team)}
            </span>
            <span className="block truncate text-[0.65rem] tabular-nums text-foreground/40 @lg:hidden">
              {record} · {points}
            </span>
            <span className="hidden truncate text-xs tabular-nums text-foreground/40 @lg:block">
              {points} PF
            </span>
          </span>
        </span>
        <span className="hidden text-right text-sm tabular-nums text-foreground/70 @lg:block">
          {record}
        </span>
      </button>
    </li>
  );
}
