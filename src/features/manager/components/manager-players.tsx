"use client";

import { useMemo } from "react";

import { adpQueryString, defaultAdpControls } from "../adp-controls";
import { useAdpControls } from "../filters-context";
import { useAdp } from "../hooks/use-adp";
import { useFilteredLeagues } from "../hooks/use-filtered-leagues";
import { useManagerPlayers } from "../hooks/use-manager-players";
import { playerShares } from "../shares";
import type { AdpPlayerPayload } from "../types";
import { AdpBoardCaption } from "./adp-filters";
import { LeaguesViewLayout } from "./leagues-view-layout";
import { ErrorCard } from "./manager-leagues-status";
import { PlayerShares } from "./player-shares";
import { PanelMessage } from "./ui";

/**
 * Player shares: who this manager owns, in how many of their leagues, and each
 * player's ADP.
 *
 * The same page as the leagues and leaguemates views — leagues stream, filters,
 * and the shared chrome of {@link LeaguesViewLayout} — reading its own resource
 * off the same stream. The rosters the leagues stream syncs are what a share is
 * counted over, so asking for them here means the page is never looking at a
 * manager the sync hasn't run for. The header filters narrow the population a
 * share is measured against rather than the players: dynasty-only and
 * redraft-only exposure are different portfolios.
 *
 * The ADP column reads the shared ADP bar — rendered by the scaffold, backed by
 * the per-manager store — for which crawled drafts the average is taken over,
 * and `useAdp` fetches that board off the global `/api/adp`. This tab owns the
 * bar's caption, which is where the draft count lands; the value-curve control in
 * the bar does nothing here (a per-player ADP is a raw number) and drives the
 * Leagues tab instead.
 */
export function ManagerPlayers({ searched }: { searched: string }) {
  const view = useFilteredLeagues(searched);
  const rosters = useManagerPlayers(searched, view.data?.leagues ?? null);

  const shares = useMemo(
    () =>
      rosters.data
        ? playerShares(view.filtered, rosters.data.rosters, rosters.data.players)
        : null,
    [view.filtered, rosters.data],
  );

  // The ADP board defaults to the season on screen; null until the stream names
  // it, which is the same beat the whole view is waiting on.
  const season = view.data?.season ?? null;
  const { controls } = useAdpControls();
  const activeControls = controls ?? (season ? defaultAdpControls(season) : null);
  const adpQuery = activeControls ? adpQueryString(activeControls) : null;
  const adp = useAdp(adpQuery);

  const adpByPlayer = useMemo(() => {
    const map = new Map<string, AdpPlayerPayload>();
    for (const player of adp.data?.players ?? []) map.set(player.player_id, player);
    return map;
  }, [adp.data]);

  return (
    <LeaguesViewLayout
      view={view}
      active="players"
      count={
        <>
          <span className="text-sm text-foreground/60">
            <b className="text-base font-bold text-foreground">
              {shares ? shares.players.length : "—"}
            </b>{" "}
            player{shares?.players.length === 1 ? "" : "s"}
          </span>
          {shares && (
            <span className="text-sm text-foreground/45">
              across {shares.league_count} league
              {shares.league_count === 1 ? "" : "s"}
            </span>
          )}
        </>
      }
      adpCaption={
        activeControls ? (
          <AdpBoardCaption
            draftCount={adp.data?.draft_count ?? null}
            loading={adp.loading}
            error={adp.error}
            season={activeControls.season}
          />
        ) : undefined
      }
    >
      {/* A failed refetch must not blank rows the hook deliberately kept —
          the error replaces the list only when there is nothing to keep. */}
      {rosters.error && !shares ? (
        <ErrorCard message={rosters.error} />
      ) : !shares ? (
        <PanelMessage>Loading rosters…</PanelMessage>
      ) : (
        <>
          {rosters.error && (
            <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-300">
              Refresh failed — showing cached data
            </div>
          )}
          {shares.players.length === 0 ? (
            // Every filtered league is one whose rosters aren't cached, or one
            // that hasn't drafted — a real answer, not the same as an error.
            <PanelMessage>No players rostered in these leagues yet.</PanelMessage>
          ) : (
            <PlayerShares
              shares={shares.players}
              leagueCount={shares.league_count}
              adp={adpByPlayer}
            />
          )}
        </>
      )}
    </LeaguesViewLayout>
  );
}
