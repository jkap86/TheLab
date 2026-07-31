"use client";

import { useMemo } from "react";

import { useFilteredLeagues } from "../hooks/use-filtered-leagues";
import { useManagerLeaguemates } from "../hooks/use-manager-leaguemates";
import { leaguemateShares } from "../leaguemates";
import { LeaguemateShares } from "./leaguemate-shares";
import { LeaguesViewLayout } from "./leagues-view-layout";
import { ErrorCard } from "./manager-leagues-status";
import { PanelMessage } from "./ui";

/**
 * Leaguemates: who this manager shares leagues with, and how many.
 *
 * The same page as the leagues and players views — leagues stream, filters, and
 * the shared chrome of {@link LeaguesViewLayout} — reading its own resource off
 * the same stream. The membership the leagues stream syncs is what a share is
 * counted over, so asking for it here means the page is never looking at a
 * manager the sync hasn't run for. The filters narrow the population a share is
 * measured against rather than the people: the crowd you play dynasty with and
 * the crowd you redraft with are different answers.
 */
export function ManagerLeaguemates({ searched }: { searched: string }) {
  const view = useFilteredLeagues(searched);
  const membership = useManagerLeaguemates(searched, view.data?.leagues ?? null);

  const selfId = view.data?.user.user_id;
  const shares = useMemo(
    () =>
      membership.data && selfId
        ? leaguemateShares(
            view.filtered,
            membership.data.members,
            membership.data.users,
            selfId,
          )
        : null,
    [view.filtered, membership.data, selfId],
  );

  return (
    <LeaguesViewLayout
      view={view}
      active="leaguemates"
      stat={{
        label: "Leaguemates",
        value: shares ? shares.mates.length : "—",
        sub: shares
          ? `across ${shares.league_count} league${shares.league_count === 1 ? "" : "s"}`
          : undefined,
      }}
      adpCaption="ADP board and value settings apply on the Players and Leagues tabs."
    >
      {/* A failed refetch must not blank rows the hook deliberately kept —
          the error replaces the list only when there is nothing to keep. */}
      {membership.error && !shares ? (
        <ErrorCard message={membership.error} />
      ) : !shares ? (
        <PanelMessage>Loading leaguemates…</PanelMessage>
      ) : (
        <>
          {membership.error && (
            <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-300">
              Refresh failed — showing cached data
            </div>
          )}
          {shares.mates.length === 0 ? (
            // Every filtered league is one whose members aren't cached, or one
            // the manager shares with nobody — a real answer, not an error.
            <PanelMessage>No leaguemates in these leagues yet.</PanelMessage>
          ) : (
            <LeaguemateShares
              mates={shares.mates}
              leagueCount={shares.league_count}
            />
          )}
        </>
      )}
    </LeaguesViewLayout>
  );
}
