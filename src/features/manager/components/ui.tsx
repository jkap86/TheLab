import { Avatar } from "@/features/shared";

import type { LeagueTeamView } from "../types";

/** Small presentational pieces shared by the standings and roster views. */

const POSITION_TONE: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300",
  RB: "bg-emerald-500/15 text-emerald-300",
  WR: "bg-sky-500/15 text-sky-300",
  TE: "bg-amber-500/15 text-amber-300",
  K: "bg-violet-500/15 text-violet-300",
  DEF: "bg-teal-500/15 text-teal-300",
};

/** What to call a team: its name, else the manager's, else the roster number. */
export function teamLabel(team: LeagueTeamView): string {
  return (
    team.manager?.team_name ||
    team.manager?.display_name ||
    `Roster ${team.roster_id}`
  );
}

/** A team's avatar, falling back to the first letter of its label. */
export function TeamAvatar({
  team,
  size = "sm",
}: {
  team: LeagueTeamView;
  size?: "sm" | "md";
}) {
  return (
    <Avatar url={team.manager?.avatar_url} name={teamLabel(team)} size={size} />
  );
}

/** A position pill, colour-coded by position. */
export function PositionBadge({
  position,
  className = "inline-flex",
}: {
  position: string | null;
  className?: string;
}) {
  const tone =
    (position && POSITION_TONE[position]) || "bg-foreground/5 text-foreground/40";
  return (
    <span
      className={`w-8 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[0.65rem] font-bold ${tone} ${className}`}
    >
      {position ?? "–"}
    </span>
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
