"use client";

import type { LeagueSubjects, Subject } from "@/features/shared";

import type { WeekLineupEntry } from "../helpers/starter-shares";
import { WeekSharesDrawer } from "./week-shares-drawer";

/**
 * Starter shares: every player on the manager's rosters this week, with how
 * many of their lineups started him and how many left him on the bench.
 *
 * It docks left, opposite the Opponents panel, because the two answer the two
 * halves of the same week and a reader comparing them should not have to watch
 * one replace the other in the same corner of the screen.
 *
 * **No server work backs it.** The whole fold is over the payload
 * `useLineupCheck` already reads — every seat, every bench player, every
 * projection is on that wire because the cards render them — so a panel that
 * counted them server-side would be a second answer to a question the page has
 * already been given, computed over a population (the reader's filters) only
 * the browser knows.
 */
export function StarterSharesDrawer(props: {
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
      side="left"
      kind="starter"
      title="Starter shares"
      noun="my players"
      emptyMessage="No lineups read for this week yet."
    />
  );
}
