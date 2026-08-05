import { Avatar, FlaskLoader } from "@/features/shared";

import { formatRecord } from "../format";
import type { LeagueTeamView, ManagerLeague } from "../types";

/** Small presentational pieces shared by the standings, roster and share views. */

// Moved to `features/shared` once the ADP drawer needed it there too;
// re-exported under its old name for this feature's own consumers
// (`player-shares`, `player-row`).
export { PositionBadge } from "@/features/shared/ui/position-badge";

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

/** The row-expander arrow. `md` is the league cards' size, `sm` the lists'. */
export function Chevron({
  open,
  size = "sm",
}: {
  open: boolean;
  size?: "sm" | "md";
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${
        size === "md"
          ? "h-4 w-4 text-foreground/40"
          : "h-3.5 w-3.5 text-foreground/30"
      } ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One of the manager's leagues under an expanded share row, named and sized —
 * the same row whether what's shared is a player or a leaguemate.
 */
export function SharedLeagueRow({ league }: { league: ManagerLeague }) {
  // A record only says something once a game has been played. In the offseason
  // every one of these is 0-0, which is a column of nothing on every row of
  // every player — the same reason the roster panel doesn't asterisk byes.
  //
  // Resolved to a string here rather than tested in the JSX, where a falsy
  // `0` would render itself.
  const record = league.record;
  const played =
    record && (record.wins || record.losses || record.ties)
      ? formatRecord(record)
      : null;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1 pl-6">
      <span className="min-w-0 truncate text-sm text-foreground/70">
        {league.name}
      </span>
      <span className="shrink-0 text-[0.7rem] tabular-nums text-foreground/40">
        {played && <>{played} · </>}
        {league.total_rosters} teams
      </span>
    </li>
  );
}

/** A full-width message standing in for the panel's content. */
export function PanelMessage({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      // Only the error tone interrupts: the muted spelling is an *answer* ("no
      // leagues match these filters"), and the count beside the control that
      // narrowed them already announces it.
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-lg border px-4 py-6 text-center text-sm ${
        tone === "error"
          ? "border-red-500/20 bg-red-500/5 text-red-300"
          : "border-foreground/10 bg-foreground/[0.02] text-foreground/45"
      }`}
    >
      {children}
    </p>
  );
}

/**
 * `PanelMessage`'s chrome around a wait, with the flask bubbling in it. The
 * panel mounts on expand and its rosters are a fetch away, so this is the one
 * panel state that is going somewhere — a still line of text says only that
 * nothing has happened yet, which is what a slow league card looked like.
 *
 * The flask is small — the panel renders at half a card's width — and the
 * message is a plain string rather than a node so it can be both the visible
 * line and the loader's accessible name: the flask already carries the
 * `role="status"`, so a second one under it would announce the wait twice.
 */
export function PanelLoading({ children }: { children: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-foreground/10 bg-foreground/[0.02] px-4 py-5 text-center text-sm text-foreground/45">
      <FlaskLoader size={36} label={children} />
      <p aria-hidden="true">{children}</p>
    </div>
  );
}
