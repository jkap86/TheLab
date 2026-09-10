"use client";

import type { LeagueSubjects, Subject } from "../league-subjects";
import type { WeekLineupEntry } from "../week-shares";
import { WeekSharesDrawer } from "./week-shares-drawer";

/**
 * Opponent shares: every player on this week's opposing rosters, on the same
 * two columns the Starters panel counts.
 *
 * It docks right, opposite Starters — see that file.
 *
 * **This one needed the wire to grow, on both tools.** `LineupCheckLeague`
 * carried `opponent_points` and nothing else about the other side, so there was
 * no opposing lineup to count; `opponent_lineup` and `opponent_bench` were added
 * beside it and are filled from the roster `compareLineup` already resolves,
 * which is why the figure on the card's plate and the players in this list are
 * one measurement rather than two. Gametime's wire had the other side from the
 * day it landed — `GametimeLeague.opponent` is a whole `GametimeSide`, because
 * its card draws the opposing lineup in a pane — so on that page this panel
 * cost nothing on the server at all.
 *
 * **The opposing side is null wherever the totals beside it are** — a future
 * week, a week Sleeper filed without a `matchup_id`, an opponent whose roster is
 * not stored — and the fold skips those leagues rather than counting them as
 * ones the opponent fielded nobody in. So the denominator here is legitimately
 * smaller than the Starters panel's, and the readout says which leagues it
 * counted.
 */
export function OpponentSharesDrawer(props: {
  open: boolean;
  onClose: () => void;
  entries: readonly WeekLineupEntry[];
  week: number | null;
  leagueTotal: number;
  filterSummary: string | null;
  figureLabel: string;
  pending: boolean;
  subjects: LeagueSubjects;
  onToggle: (subject: Subject) => void;
}) {
  return (
    <WeekSharesDrawer
      {...props}
      side="right"
      kind="opponent"
      title="Opponent shares"
      noun="opposing players"
      emptyMessage="No opponent is scheduled in these leagues this week."
    />
  );
}
