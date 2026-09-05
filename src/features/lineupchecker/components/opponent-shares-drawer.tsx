"use client";

import type { LeagueSubjects, Subject } from "@/features/shared";

import type { WeekLineupEntry } from "../helpers/starter-shares";
import { WeekSharesDrawer } from "./week-shares-drawer";

/**
 * Opponent shares: every player on this week's opposing rosters, on the same
 * two columns the Starters panel counts.
 *
 * It docks right, opposite Starters — see that file.
 *
 * **This one needed the wire to grow.** `LineupCheckLeague` carried
 * `opponent_points` and nothing else about the other side, so there was no
 * opposing lineup to count; `opponent_lineup` and `opponent_bench` were added
 * beside it and are filled from the roster `compareLineup` already resolves,
 * which is why the figure on the card's plate and the players in this list are
 * one measurement rather than two.
 *
 * **Both fields are null wherever `opponent_points` is** — a future week, a week
 * Sleeper filed without a `matchup_id`, an opponent whose roster is not stored
 * — and the fold skips those leagues rather than counting them as ones the
 * opponent fielded nobody in. So the denominator here is legitimately smaller
 * than the Starters panel's, and the readout says which leagues it counted.
 */
export function OpponentSharesDrawer(props: {
  open: boolean;
  onClose: () => void;
  entries: readonly WeekLineupEntry[];
  week: number | null;
  leagueTotal: number;
  filterSummary: string | null;
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
