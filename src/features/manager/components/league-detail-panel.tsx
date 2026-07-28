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
          outlook={data.outlook}
          selectedId={selected.roster_id}
          onSelect={setSelectedId}
        />
        <RosterDetail
          team={selected}
          players={data.players}
          rosterPositions={data.roster_positions}
          outlook={data.outlook}
        />
      </div>
      <OutlookCaveat data={data} />
    </div>
  );
}

/** Slots whose players Sleeper barely projects — see {@link OutlookCaveat}. */
const DEFENSIVE_SLOTS = new Set(["DEF", "DL", "LB", "DB", "IDP_FLEX"]);

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
