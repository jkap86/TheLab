"use client";

import { useMemo, useState } from "react";

import { PageShell } from "@/features/shared";

import {
  DEFAULT_LEAGUE_FILTERS,
  matchesFilters,
  type LeagueFilters,
} from "../filters";
import { useManagerLeagues } from "../hooks/use-manager-leagues";
import { useManagerPlayers } from "../hooks/use-manager-players";
import { playerShares } from "../shares";
import { ManagerHeader } from "./manager-header";
import { LeaguesFilters } from "./manager-leagues-filters";
import { EmptyState, ErrorCard, LoadingState } from "./manager-leagues-status";
import { PlayerShares } from "./player-shares";
import { PanelMessage } from "./ui";

/**
 * Player shares: who this manager owns, and in how many of their leagues.
 *
 * Rides on the same leagues stream as the leagues view — that is what syncs the
 * rosters this counts over, so asking for it here means the page is never
 * looking at a manager the sync hasn't run for. It also gives the filters
 * something to filter: the controls are the leagues view's, unchanged, and they
 * narrow the population a share is measured against rather than the players.
 * Dynasty-only exposure and redraft-only exposure are different portfolios.
 */
export function ManagerPlayers({ searched }: { searched: string }) {
  const { data, progress, refreshing, error } = useManagerLeagues(searched);
  const rosters = useManagerPlayers(searched, data?.leagues ?? null);
  const [filters, setFilters] = useState<LeagueFilters>(DEFAULT_LEAGUE_FILTERS);

  const leagues = data?.leagues;
  const filtered = useMemo(
    () => (leagues ?? []).filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  const shares = useMemo(
    () =>
      rosters.data
        ? playerShares(filtered, rosters.data.rosters, rosters.data.players)
        : null,
    [filtered, rosters.data],
  );

  // Cold load: nothing cached yet.
  if (!data) {
    return (
      <PageShell width="wide">
        {error ? (
          <ErrorCard message={error} />
        ) : (
          <LoadingState searched={searched} progress={progress} />
        )}
      </PageShell>
    );
  }

  const { user, season, summary } = data;

  return (
    <PageShell width="wide">
      <ManagerHeader
        user={user}
        searched={searched}
        active="players"
        season={season}
        refreshing={refreshing}
        progress={progress}
        summary={summary}
      >
        <span className="text-lg font-medium">
          {shares ? shares.players.length : "—"} player
          {shares?.players.length === 1 ? "" : "s"}
        </span>
        {shares && (
          <span className="text-sm text-foreground/45">
            across {shares.league_count} league
            {shares.league_count === 1 ? "" : "s"}
          </span>
        )}
      </ManagerHeader>

      {data.leagues.length === 0 ? (
        <EmptyState season={season} />
      ) : (
        <>
          <LeaguesFilters filters={filters} onChange={setFilters} />
          {rosters.error ? (
            <ErrorCard message={rosters.error} />
          ) : filtered.length === 0 ? (
            <PanelMessage>No leagues match these filters.</PanelMessage>
          ) : !shares ? (
            <PanelMessage>Loading rosters…</PanelMessage>
          ) : shares.players.length === 0 ? (
            // Every filtered league is one whose rosters aren't cached, or one
            // that hasn't drafted — a real answer, and not the same as an error.
            <PanelMessage>
              No players rostered in these leagues yet.
            </PanelMessage>
          ) : (
            <PlayerShares
              shares={shares.players}
              leagueCount={shares.league_count}
            />
          )}
        </>
      )}
    </PageShell>
  );
}
