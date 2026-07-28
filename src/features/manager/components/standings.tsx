import { formatPoints, formatRecord, formatWeekRange } from "../format";
import type { LeagueOutlook, LeagueTeamView } from "../types";
import { managerLabel, TeamAvatar } from "./ui";

/** What a team projects over the horizon, in its lineups and behind them. */
type TeamProjection = { points: number; bench: number };

/**
 * The league table, in standings order. Selecting a row drives the roster panel
 * beside it.
 *
 * Two lines per row. The team name gets the first one to itself, because at a
 * 50/50 split it was the thing losing every fight for horizontal space — a name
 * squeezed between an avatar, a record and two totals truncates to nothing, and it
 * is the one field a reader is actually scanning for. The record, points for and
 * both projections sit on the second line under it.
 *
 * The numbers keep their own columns on that line rather than being folded into a
 * sentence: they are the values worth comparing down the table, and a total buried
 * in a run of text under each name can't be.
 *
 * Bench sits beside Proj rather than replacing anything because the pair says
 * what neither says alone — two teams projecting the same points are not the same
 * team if one is carrying twice as much behind its starters.
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
    ? new Map(
        outlook.teams.map((t) => [
          t.roster_id,
          { points: t.weekly_optimal_points, bench: t.weekly_bench_points },
        ]),
      )
    : null;

  // Written out rather than assembled, so Tailwind sees both class strings.
  const columns = projected
    ? "grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] @lg:grid-cols-[2rem_minmax(0,1fr)_auto_auto]"
    : "grid-cols-[1.25rem_minmax(0,1fr)] @lg:grid-cols-[2rem_minmax(0,1fr)]";
  const nameSpan = projected ? "col-span-3" : "col-span-1";

  return (
    <div className="overflow-hidden rounded-lg border border-foreground/10">
      <div
        className={`grid ${columns} items-center gap-x-1 border-b border-foreground/10 bg-foreground/[0.03] px-1.5 py-2 text-[0.65rem] uppercase tracking-wide text-foreground/40 @lg:gap-x-2 @lg:px-3 @lg:text-xs`}
      >
        <span className="text-center">#</span>
        <span className="truncate">Manager</span>
        {projected && <span className="text-right">Proj</span>}
        {projected && <span className="text-right">Bench</span>}
      </div>
      <ul>
        {teams.map((team, i) => (
          <StandingsRow
            key={team.roster_id}
            team={team}
            rank={i + 1}
            columns={columns}
            nameSpan={nameSpan}
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
          Proj · best lineup each week · Bench · what those lineups don&apos;t
          start · {formatWeekRange(outlook.weeks)}
        </p>
      )}
    </div>
  );
}

function StandingsRow({
  team,
  rank,
  columns,
  nameSpan,
  projected,
  active,
  onSelect,
}: {
  team: LeagueTeamView;
  rank: number;
  columns: string;
  /** How far the name reaches on its own line — the meta column plus the totals. */
  nameSpan: string;
  /**
   * Rest-of-season totals, started and benched: `undefined` when the league has no
   * projections at all and the columns aren't there, `null` when they are and this
   * team has no numbers for them.
   */
  projected: TeamProjection | null | undefined;
  active: boolean;
  onSelect: () => void;
}) {
  const record = formatRecord(team.record);
  const points = formatPoints(team.fpts);

  // The username identifies the person; the team name is a per-league nickname
  // that changes at will. Showing the username means the same opponent reads the
  // same across every league, and the team name isn't lost — it moves to the
  // hover, and the roster panel beside this one still leads with it.
  const manager = managerLabel(team);
  const teamName = team.manager?.team_name;
  const title = teamName && teamName !== manager ? `${manager} · ${teamName}` : manager;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={title}
        aria-current={active ? "true" : undefined}
        className={`grid w-full ${columns} items-center gap-x-1 gap-y-0.5 border-l-2 px-1.5 py-1.5 text-left transition-colors @lg:gap-x-2 @lg:px-3 @lg:py-2 ${
          active
            ? "border-active bg-active/10"
            : "border-transparent hover:bg-foreground/[0.04]"
        }`}
      >
        {/* Spans both lines, so the rank numbers a team rather than a line. */}
        <span className="row-span-2 self-center text-center text-[0.65rem] tabular-nums text-foreground/40 @lg:text-sm">
          {rank}
        </span>

        <span className={`${nameSpan} flex min-w-0 items-center gap-1 @lg:gap-2`}>
          <TeamAvatar team={team} label={manager} />
          <span className="min-w-0 truncate text-xs font-medium text-foreground/90 @lg:text-sm">
            {manager}
          </span>
        </span>

        <span className="col-start-2 truncate text-[0.65rem] tabular-nums text-foreground/40 @lg:text-xs">
          {record} · {points} PF
        </span>

        {projected !== undefined && (
          <>
            <span
              title={
                projected === null
                  ? "No projection"
                  : `${formatPoints(projected.points)} projected, setting the best lineup each week`
              }
              className={`text-right text-[0.7rem] tabular-nums @lg:text-sm ${
                projected === null ? "text-foreground/25" : "text-foreground/70"
              }`}
            >
              {projected === null ? "—" : formatPoints(projected.points)}
            </span>
            {/* Dimmer than the projected total on purpose: it is context for that
                number rather than a rival to it, and a table of two equally loud
                columns reads as though they were meant to be compared. */}
            <span
              title={
                projected === null
                  ? "No projection"
                  : `${formatPoints(projected.bench)} projected for players those lineups never start`
              }
              className="text-right text-[0.7rem] tabular-nums text-foreground/40 @lg:text-sm"
            >
              {projected === null ? "—" : formatPoints(projected.bench)}
            </span>
          </>
        )}
      </button>
    </li>
  );
}
