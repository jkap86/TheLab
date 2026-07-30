"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Both imported directly rather than through their barrels, which would pull
// `pg`-backed code into the client bundle — see `slots.ts` and `rank.ts`.
import { orderByProjectedPoints } from "@/shared/manager/rank";
import { DEFENSIVE_SLOTS } from "@/shared/projections/slots";

import { useLeagueDetail } from "../hooks/use-league-detail";
import { DEFAULT_PLAYER_COLUMNS } from "../roster-metrics";
import { DEFAULT_TEAM_COLUMNS } from "../standings-metrics";
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
  const { data, loading, error } = useLeagueDetail(leagueId);

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
  // Projected-points order, not standings order — the table's own Proj column
  // is what the rows are ranked on, so the numbers descend down the page and
  // the row's position agrees with the rank chip on the collapsed card. Ties
  // and teams with no projection (or a league with none at all) fall back to
  // the standings order the server sent.
  const teams = useMemo(
    () =>
      orderByProjectedPoints(
        data.teams,
        data.outlook
          ? new Map(
              data.outlook.teams.map((t) => [t.roster_id, t.weekly_optimal_points]),
            )
          : null,
      ),
    [data],
  );

  const [selectedId, setSelectedId] = useState<number>(teams[0].roster_id);
  const selected = teams.find((t) => t.roster_id === selectedId) ?? teams[0];

  // Each table's two value columns are slots the reader points at a metric — the
  // standings at a team-level one, the roster at a player-level one. The
  // selection is held here rather than in either table so it outlives switching
  // the selected team, and so one picker-at-a-time and an outside click have a
  // single owner (as they do on the collapsed card).
  const [teamColumns, setTeamColumns] = useState<string[]>(DEFAULT_TEAM_COLUMNS);
  const [rosterColumns, setRosterColumns] = useState<string[]>(
    DEFAULT_PLAYER_COLUMNS,
  );
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openPicker === null) return;
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpenPicker(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPicker(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPicker]);

  const togglePicker = (key: string) =>
    setOpenPicker((current) => (current === key ? null : key));
  const pickTeamColumn = (slot: number, key: string) => {
    setTeamColumns((cols) => cols.map((c, i) => (i === slot ? key : c)));
    setOpenPicker(null);
  };
  const pickRosterColumn = (slot: number, key: string) => {
    setRosterColumns((cols) => cols.map((c, i) => (i === slot ? key : c)));
    setOpenPicker(null);
  };

  // The open menu overhangs the rows below it, so the half it opens from lifts its
  // stacking order over the other while a picker is open.
  const teamPickerOpen = openPicker?.startsWith("team-") ?? false;

  // Even 50/50 split at every width; the children use @lg container queries to
  // shed non-essential columns once each half gets tight.
  return (
    <div ref={panelRef} className="@container">
      <div className="grid grid-cols-2 gap-2 @lg:gap-4">
        <Standings
          teams={teams}
          outlook={data.outlook}
          selectedId={selected.roster_id}
          onSelect={setSelectedId}
          columns={teamColumns}
          openPicker={openPicker}
          onTogglePicker={togglePicker}
          onSelectColumn={pickTeamColumn}
          elevated={teamPickerOpen}
        />
        <RosterDetail
          team={selected}
          teams={teams}
          players={data.players}
          rosterPositions={data.roster_positions}
          outlook={data.outlook}
          values={data.values}
          columns={rosterColumns}
          openPicker={openPicker}
          onTogglePicker={togglePicker}
          onSelectColumn={pickRosterColumn}
          elevated={openPicker !== null && !teamPickerOpen}
        />
      </div>
      <OutlookCaveat data={data} />
    </div>
  );
}

/**
 * Says so when this league's projections are known to be incomplete.
 *
 * Two caveats, gated differently, which is why they aren't one line. Missing
 * categories are near enough always non-empty — every league carries weights for
 * defence and special-teams events Sleeper doesn't project — so they are only
 * worth a warning where those categories actually score: a league that starts a
 * DEF or an IDP. Derived categories are the opposite: first downs and reception
 * splits are scored on skill players, so they apply to every team in a league
 * that pays for them, and there is nothing to gate on.
 *
 * League-level facts, so they are stated once under the panel rather than on each
 * team.
 */
function OutlookCaveat({ data }: { data: LeagueDetailResult }) {
  const missing = data.outlook?.unprojected_scoring.length ?? 0;
  const derived = data.outlook?.derived_scoring ?? [];
  const startsDefence = (data.roster_positions ?? []).some((slot) =>
    DEFENSIVE_SLOTS.has(slot),
  );
  if (derived.length === 0 && (missing === 0 || !startsDefence)) return null;

  return (
    <div className="mt-2 space-y-1 text-[0.7rem] leading-relaxed text-foreground/40">
      {derived.length > 0 && (
        <p>
          This league scores {derived.join(", ")}, which Sleeper publishes as a
          formula rather than a projection — a &ldquo;first down&rdquo; is just
          the yardage over ten. Those categories are left out of the totals here.
        </p>
      )}
      {missing > 0 && startsDefence && (
        <p>
          This league starts defensive players and scores {missing} categories
          Sleeper doesn&apos;t project, so their projected points read low and the
          optimal lineup will under-start them.
        </p>
      )}
    </div>
  );
}
