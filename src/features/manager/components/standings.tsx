import { formatPoints, formatRecord, formatWeekRange } from "../format";
import type { LeagueOutlook, LeagueTeamView } from "../types";
import { teamLabel, TeamAvatar } from "./ui";

/**
 * The league table, in standings order. Selecting a row drives the roster panel
 * beside it.
 *
 * Below the `@lg` container width the record moves onto a second line under the
 * team name rather than keeping a column of its own — at a 50/50 split there
 * isn't room for both. The projected total keeps its column at every width: it is
 * the one number here that's worth comparing down the table, which a value buried
 * in a line of text under each name isn't.
 */
export function Standings({
  teams,
  outlook,
  selectedId,
  onSelect,
}: {
  teams: LeagueTeamView[];
  outlook: LeagueOutlook | null;
  selectedId: number;
  onSelect: (rosterId: number) => void;
}) {
  const projected = outlook
    ? new Map(outlook.teams.map((t) => [t.roster_id, t.weekly_optimal_points]))
    : null;

  // Written out rather than assembled, so Tailwind sees both class strings.
  const columns = projected
    ? "grid-cols-[1rem_minmax(0,1fr)_auto] @lg:grid-cols-[2rem_minmax(0,1fr)_auto_auto]"
    : "grid-cols-[1rem_minmax(0,1fr)] @lg:grid-cols-[2rem_minmax(0,1fr)_auto]";

  return (
    <div className="overflow-hidden rounded-lg border border-foreground/10">
      <div
        className={`grid ${columns} items-center gap-1 border-b border-foreground/10 bg-foreground/[0.03] px-1.5 py-2 text-[0.65rem] uppercase tracking-wide text-foreground/40 @lg:gap-2 @lg:px-3 @lg:text-xs`}
      >
        <span className="text-center">#</span>
        <span className="truncate">Manager</span>
        <span className="hidden text-right @lg:block">Rec</span>
        {projected && <span className="text-right">Proj</span>}
      </div>
      <ul>
        {teams.map((team, i) => (
          <StandingsRow
            key={team.roster_id}
            team={team}
            rank={i + 1}
            columns={columns}
            projected={projected ? (projected.get(team.roster_id) ?? null) : undefined}
            active={team.roster_id === selectedId}
            onSelect={() => onSelect(team.roster_id)}
          />
        ))}
      </ul>
      {outlook && (
        // The horizon travels with the number, as it does on the roster panel:
        // "rest of season" is however many weeks are actually stored, and a total
        // over three weeks next to one over eighteen is a different claim.
        <p className="border-t border-foreground/10 px-1.5 py-1.5 text-[0.65rem] leading-relaxed text-foreground/35 @lg:px-3">
          Proj · best lineup each week · {formatWeekRange(outlook.weeks)}
        </p>
      )}
    </div>
  );
}

function StandingsRow({
  team,
  rank,
  columns,
  projected,
  active,
  onSelect,
}: {
  team: LeagueTeamView;
  rank: number;
  columns: string;
  /**
   * Rest-of-season total: `undefined` when the league has no projections at all
   * and the column isn't there, `null` when the column is and this team has no
   * number for it.
   */
  projected: number | null | undefined;
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
        className={`grid w-full ${columns} items-center gap-1 border-l-2 px-1.5 py-1.5 text-left transition-colors @lg:gap-2 @lg:px-3 @lg:py-2 ${
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
        {projected !== undefined && (
          <span
            title={
              projected === null
                ? "No projection"
                : `${formatPoints(projected)} projected, setting the best lineup each week`
            }
            className={`text-right text-[0.7rem] tabular-nums @lg:text-sm ${
              projected === null ? "text-foreground/25" : "text-foreground/70"
            }`}
          >
            {projected === null ? "—" : formatPoints(projected)}
          </span>
        )}
      </button>
    </li>
  );
}
