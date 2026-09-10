"use client";

import type { LeagueSubjects, Subject } from "../league-subjects";
import type { WeekLineupEntry } from "../week-shares";
import { WeekSharesDrawer } from "./week-shares-drawer";

/**
 * Starter shares: every player on the manager's rosters this week, with how
 * many of their lineups started him and how many left him on the bench.
 *
 * It docks left, opposite the Opponents panel, because the two answer the two
 * halves of the same week and a reader comparing them should not have to watch
 * one replace the other in the same corner of the screen.
 *
 * **No server work backs it, on either tool.** The whole fold is over the
 * payload the page already holds — every seat, every bench player, every figure
 * is on that wire because the cards render them — so a panel that counted them
 * server-side would be a second answer to a question the page has already been
 * given, computed over a population (the reader's filters) only the browser
 * knows. That is as true of gametime's stream as of the checker's fetch: a
 * frame carries the lineups, and the fold is a walk over what arrived.
 *
 * **Both week tools mount it**, which is what put it here rather than in either
 * of them. What each supplies is the entries — adapted from its own wire — and
 * `figureLabel`, the word for the scale its figures are on.
 */
export function StarterSharesDrawer(props: {
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
      side="left"
      kind="starter"
      title="Starter shares"
      noun="my players"
      emptyMessage="No lineups read for this week yet."
    />
  );
}
