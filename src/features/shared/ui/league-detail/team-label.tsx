import { Avatar } from "../avatar";

import type { LeagueTeamView } from "./types";

/** How this panel names a team, and the avatar that goes beside the name. */

/** What to call a team: its name, else the manager's, else the roster number. */
export function teamLabel(team: LeagueTeamView): string {
  return (
    team.manager?.team_name ||
    team.manager?.display_name ||
    `Roster ${team.roster_id}`
  );
}

/**
 * What to call the person: their Sleeper username, else the team name, else the
 * roster number.
 *
 * The inverse of {@link teamLabel}, and the right label for a list of *managers*.
 * A team name is a nickname someone picked for one league and changes at will, so
 * the same person reads as a different opponent in every league they're in; the
 * username is who they are everywhere. Falls back to the team name rather than
 * straight to the roster number, because a made-up name still identifies someone
 * better than "Roster 7" does.
 */
export function managerLabel(team: LeagueTeamView): string {
  return (
    team.manager?.display_name ||
    team.manager?.team_name ||
    `Roster ${team.roster_id}`
  );
}

/**
 * A team's avatar, falling back to the first letter of a label.
 *
 * `label` overrides which one, so the initial matches the name shown beside it —
 * a standings row reading `jkap86` next to a `T` would look like a mismatch.
 */
export function TeamAvatar({
  team,
  size = "sm",
  label,
}: {
  team: LeagueTeamView;
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <Avatar
      url={team.manager?.avatar_url}
      name={label ?? teamLabel(team)}
      size={size}
    />
  );
}
