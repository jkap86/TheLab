import { formatPoints } from "../../format";
import { managerLabel, TeamAvatar } from "./team-label";
import type { LeagueTeamView, LeagueWeekView } from "./types";

/**
 * Whose roster a half is listing, and what it projects for the week.
 *
 * **It exists because the standings stopped naming it.** A roster half has never
 * headed itself — the plate that used to do it (avatar, team name, record, points
 * for) was removed for restating the lit standings row a few pixels to its left,
 * which is the rule that a panel driven by a selection must not restate the
 * selection. A week panel has no standings and no selection: it is two rosters
 * side by side, and without a name on each the reader cannot tell which one is
 * theirs. So the argument that removed the plate is what puts this line back, and
 * only where it applies — the season panel still heads its one roster with
 * nothing.
 *
 * It is a line rather than a plate for the same reason it went the first time:
 * the halves are ~155px wide on a phone, and the panel cannot spend a card's
 * worth of chrome on each before a player is listed. One row — avatar, name,
 * number — and it sits in the half's *fixed* head, above the column rail, so it
 * stays on screen while the roster under it scrolls.
 *
 * **The name is the manager's, not the team's** — the standings' own rule, and it
 * matters more here than there: this panel is opened from a list spanning a whole
 * portfolio, where the same opponent turns up in several leagues and a team name
 * is a nickname somebody picked for one of them. The team name is on the hover,
 * which is the only place it is written.
 *
 * **The number is the best lineup available, with what they have actually set on
 * the hover** — spelled exactly as the `week_proj` column spells it, because it
 * is that column's number at the team's grain and one figure written two ways is
 * the drift this codebase keeps closing. Comparing two *best* lineups is the
 * like-for-like reading of "who wins this week"; what each side has currently set
 * is the other question, and it is a hover away on both halves.
 *
 * Absent where the week could not be projected — an em dash would put a hole on a
 * line whose job is to name somebody, and the halves below say the same thing at
 * every row.
 */
export function RosterHeading({
  team,
  weekView,
  opponent,
}: {
  team: LeagueTeamView;
  /** The week's numbers — null leaves the line as a name and nothing else. */
  weekView: LeagueWeekView;
  /** Whether this is the team on the *other* side of the reader's game. */
  opponent: boolean;
}) {
  const manager = managerLabel(team);
  const teamName = team.manager?.team_name;
  const title =
    teamName && teamName !== manager ? `${manager} · ${teamName}` : manager;

  // Roster ids are numbers here and JSON keys there, so the lookup is by
  // template string rather than pretending the map is numeric — the standings'
  // own spelling of the same read.
  const projection = weekView?.team_projection[`${team.roster_id}`] ?? null;

  return (
    // `shrink-0`, because it is part of the head the list scrolls under: a name
    // that can be compressed out of the way is a half with nobody's name on it.
    <div className="mb-2 flex shrink-0 items-center gap-1.5 pr-1">
      {/* `vs` rather than nothing, and it is the card's own word: the plate on
          the trailing corner of the card this panel opened out of says
          `vs <name>`, so the half showing that team says it too. It is also what
          keeps a reader from having to know that left means theirs. */}
      {opponent && (
        <span
          aria-hidden="true"
          className="shrink-0 text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-foreground/40"
        >
          vs
        </span>
      )}
      <TeamAvatar team={team} label={manager} />
      <span
        title={title}
        className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-foreground/85 @lg:text-[0.875rem]"
      >
        {/* Which half this is, for a reader who has neither the layout nor the
            `vs` glyph — the two halves are otherwise the same list twice. */}
        <span className="sr-only">
          {opponent ? "Opponent: " : "Your team: "}
        </span>
        {manager}
      </span>
      {projection && (
        <span
          title={
            `${formatPoints(projection.optimal)} from the best lineup available` +
            ` · ${formatPoints(projection.current)} as currently set` +
            (projection.points_left > 0
              ? ` · ${formatPoints(projection.points_left)} left on the bench`
              : "")
          }
          className="lab-readout shrink-0 rounded px-1.5 py-px font-mono text-[0.6875rem] font-semibold leading-4 tabular-nums text-foreground/80"
        >
          {formatPoints(projection.optimal)}
        </span>
      )}
    </div>
  );
}
