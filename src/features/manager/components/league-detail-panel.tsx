"use client";

import { useState } from "react";

import { useLeagueDetail } from "../hooks/use-league-detail";
import type { LeagueDetailResult } from "../types";
import { RosterDetail } from "./roster-detail";
import { Standings } from "./standings";
import { PanelMessage } from "./ui";

/**
 * The expanded contents of a league card: standings on the left, the selected
 * team's roster on the right. Loads its own data the first time it mounts,
 * which is when its card is expanded.
 */
export function LeagueDetailPanel({ leagueId }: { leagueId: string }) {
  const { data, loading, error } = useLeagueDetail(leagueId, true);

  if (loading && !data) {
    return <PanelMessage>Loading rosters…</PanelMessage>;
  }
  if (error) {
    return <PanelMessage tone="error">{error}</PanelMessage>;
  }
  if (!data || data.teams.length === 0) {
    return <PanelMessage>No roster data yet.</PanelMessage>;
  }

  return <Panel data={data} />;
}

function Panel({ data }: { data: LeagueDetailResult }) {
  const [selectedId, setSelectedId] = useState<number>(data.teams[0].roster_id);
  const selected =
    data.teams.find((t) => t.roster_id === selectedId) ?? data.teams[0];

  // Even 50/50 split at every width; the children use @lg container queries to
  // shed non-essential columns once each half gets tight.
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2 @lg:gap-4">
        <Standings
          teams={data.teams}
          selectedId={selected.roster_id}
          onSelect={setSelectedId}
        />
        <RosterDetail
          team={selected}
          players={data.players}
          rosterPositions={data.roster_positions}
        />
      </div>
    </div>
  );
}
